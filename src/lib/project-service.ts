/**
 * 作品领域服务。
 *
 * 设计真源：docs/class-diagram.mermaid `ProjectService`、
 * docs/P0-架构与任务分解.md §3.2 / §3.3。
 *
 * 铁律：
 *   1. Route Handler 只做「解析入参 → 调服务 → ok()/toErrorResponse()」，
 *      所有业务规则收敛在本文件，禁止在路由里写 prisma 查询。
 *   2. DB 与磁盘的一致性由本文件负责：先落盘、后写库，写库失败回滚磁盘。
 *   3. PRIVATE 与「不存在」对外表现完全一致（统一 NOT_FOUND），不用 403 泄漏存在性。
 */

import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_TTL_DAYS,
  KERNEL_VERSION,
  LOCAL_DEMO_USER_ID,
  MAX_AUTHOR_ALIAS_LEN,
  MAX_DESCRIPTION_LEN,
  MAX_PAGE_SIZE,
  MAX_SUMMARY_LEN,
  MAX_TITLE_LEN,
  PROJECT_STATUS,
  RECYCLE_BIN_DAYS,
  SLUG_MAX_RETRY,
  SOURCE_TYPE,
  TTL_OPTIONS,
  UPLOAD_MODE,
  VISIBILITY,
  type ProjectStatus,
  type SourceType,
  type Visibility,
} from './constants';
import { Prisma } from '@prisma/client';
import { cached, invalidateTag } from './data-cache';
import { buildCoverSvg } from './cover';
import { computeExpireAt, MS_PER_DAY } from './format';
import { prisma } from './prisma';
import { AppError, ERROR_CODE } from './response';
import { buildDetailUrl, buildSandboxUrl } from './sandbox';
import { generateUnique } from './slug';
import {
  commitToProject,
  removeProjectDir,
  resolveProjectDir,
  writeCover,
  writeMeta,
} from './storage';
import type {
  CreateProjectInput,
  CreateProjectResult,
  FileNode,
  MyProjectStats,
  PagedResult,
  PatchProjectInput,
  ProjectDTO,
  ProjectListQuery,
  ProjectMeta,
} from './types';
import * as uploadSession from './upload/session';
import { assertPublicHttpUrl } from './upload/validate';

/* ============================================================================
   0) 行 → DTO
   ========================================================================== */

/** prisma 查询时统一带上的关联，保证 DTO 字段齐全。 */
const PROJECT_INCLUDE = { author: true, stats: true } as const;

/** 与 `PROJECT_INCLUDE` 对应的最小结构化行类型（避免依赖生成态 Prisma 类型）。 */
interface ProjectRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  coverUrl: string | null;
  sourceType: string;
  externalUrl: string | null;
  entryFile: string;
  fileCount: number;
  sizeBytes: number;
  visibility: string;
  status: string;
  ttlDays: number;
  expireAt: Date;
  archivedAt: Date | null;
  purgeAt: Date | null;
  pinned: boolean;
  authorAlias: string | null;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
  author: { nickname: string } | null;
  stats: { viewCount: number; voteCount: number } | null;
}

/**
 * 把 prisma 行转换为对外 DTO。
 *
 * 时间一律 ISO 8601 UTC 字符串，避免 Server / Client 序列化差异。
 */
export function toDTO(row: ProjectRow, favoriteCount = 0): ProjectDTO {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    coverUrl: row.coverUrl,
    sourceType: row.sourceType as SourceType,
    externalUrl: row.externalUrl,
    entryFile: row.entryFile,
    fileCount: row.fileCount,
    sizeBytes: row.sizeBytes,
    visibility: row.visibility as Visibility,
    status: row.status as ProjectStatus,
    ttlDays: row.ttlDays,
    expireAt: row.expireAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    purgeAt: row.purgeAt ? row.purgeAt.toISOString() : null,
    pinned: row.pinned,
    authorAlias: row.authorAlias,
    authorId: row.authorId,
    authorName: row.authorAlias ?? row.author?.nickname ?? '匿名创作者',
    viewCount: row.stats?.viewCount ?? 0,
    voteCount: row.stats?.voteCount ?? 0,
    favoriteCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sandboxUrl: buildSandboxUrl(row.slug),
    detailUrl: buildDetailUrl(row.slug),
  };
}

/* ============================================================================
   1) 入参校验
   ========================================================================== */

/** 去首尾空白；空串归一为 undefined。 */
function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** 去首尾空白；空串归一为 null（用于可清空字段）。 */
function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 校验一段文本的长度。
 *
 * @throws AppError VALIDATION_FAILED
 */
function assertLength(value: string | null | undefined, max: number, label: string): void {
  if (value != null && value.length > max) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, `${label}不能超过 ${max} 个字符`);
  }
}

/** 校验可见性取值。 */
function normalizeVisibility(value: unknown): Visibility {
  if (value == null) return VISIBILITY.PUBLIC;
  const list: string[] = [VISIBILITY.PUBLIC, VISIBILITY.UNLISTED, VISIBILITY.PRIVATE];
  if (typeof value !== 'string' || !list.includes(value)) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '可见性取值不合法');
  }
  return value as Visibility;
}

/** 校验 TTL 天数，必须落在预设档位内。 */
function normalizeTtlDays(value: unknown): number {
  if (value == null) return DEFAULT_TTL_DAYS;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || !TTL_OPTIONS.includes(num)) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, `有效期只能是 ${TTL_OPTIONS.join(' / ')} 天`);
  }
  return num;
}

/** 校验标题必填且长度合规。 */
function normalizeTitle(value: unknown): string {
  const title = trimOrUndefined(value);
  if (!title) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请填写作品标题');
  }
  assertLength(title, MAX_TITLE_LEN, '标题');
  return title;
}

/* ============================================================================
   2) 创建
   ========================================================================== */

/** 确保本地演示用户存在（P0 无登录，全部作品挂在它名下）。 */
export async function ensureLocalUser(): Promise<string> {
  await prisma.user.upsert({
    where: { id: LOCAL_DEMO_USER_ID },
    update: {},
    create: { id: LOCAL_DEMO_USER_ID, nickname: '本地创作者' },
  });
  return LOCAL_DEMO_USER_ID;
}

/** 在候选文件列表中确认用户指定的入口文件，非法时回落到建议值。 */
function resolveEntryFile(requested: string | undefined, fileList: string[], suggested: string): string {
  if (!requested) return suggested;
  const normalized = requested.replace(/^\.?\//, '').trim();
  if (normalized === '') return suggested;
  if (!fileList.includes(normalized)) {
    throw new AppError(ERROR_CODE.ENTRY_FILE_NOT_FOUND, `压缩包内不存在 ${normalized}`);
  }
  if (!/\.html?$/i.test(normalized)) {
    throw new AppError(ERROR_CODE.ENTRY_FILE_NOT_FOUND, '入口文件必须是 .html 文件');
  }
  return normalized;
}

/** 收集文件树中的全部文件相对路径（用于校验入口文件）。 */
function flattenTree(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (list: FileNode[]): void => {
    for (const node of list) {
      if (node.dir) {
        walk(node.children ?? []);
      } else {
        out.push(node.path);
      }
    }
  };
  walk(nodes);
  return out;
}

/**
 * 创建作品。
 *
 * 三种来源共用同一条主干：
 *   - ZIP / SINGLE_FILE：`uploadId` 已经过 upload-complete 的安全校验，此处只做落盘迁移；
 *   - EXTERNAL_URL：无磁盘目录，仅入库。
 *
 * 一致性策略：先迁移磁盘目录，再写库；写库失败则回滚删除目录。
 *
 * @throws AppError VALIDATION_FAILED / UPLOAD_SESSION_* / SLUG_CONFLICT / STORAGE_ERROR
 */
export async function create(input: CreateProjectInput): Promise<CreateProjectResult> {
  const title = normalizeTitle(input.title);
  const summary = trimOrNull(input.summary);
  const description = trimOrNull(input.description);
  const authorAlias = trimOrNull(input.authorAlias);
  const visibility = normalizeVisibility(input.visibility);
  const ttlDays = normalizeTtlDays(input.ttlDays);

  assertLength(summary, MAX_SUMMARY_LEN, '一句话简介');
  assertLength(description, MAX_DESCRIPTION_LEN, '详细介绍');
  assertLength(authorAlias, MAX_AUTHOR_ALIAS_LEN, '作者昵称');

  const uploadId = trimOrUndefined(input.uploadId);
  const externalUrlRaw = trimOrUndefined(input.externalUrl);

  if (!uploadId && !externalUrlRaw) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请先完成文件上传或填写外链地址');
  }

  const authorId = input.authorId ?? (await ensureLocalUser());
  const expireAt = computeExpireAt(ttlDays);
  const slug = await generateUnique(async (candidate) => {
    const hit = await prisma.project.findUnique({ where: { slug: candidate }, select: { id: true } });
    return hit !== null;
  }, SLUG_MAX_RETRY);

  /* ---------- 分支 A：外链 ---------- */
  if (!uploadId && externalUrlRaw) {
    const url = assertPublicHttpUrl(externalUrlRaw);
    await writeCover(slug, buildCoverSvg(slug, title));

    const row = await prisma.project.create({
      data: {
        slug,
        title,
        summary,
        description,
        coverUrl: `/api/covers/${slug}.svg`,
        sourceType: SOURCE_TYPE.EXTERNAL_URL,
        externalUrl: url.toString(),
        entryFile: '',
        fileCount: 0,
        sizeBytes: 0,
        visibility,
        status: PROJECT_STATUS.ACTIVE,
        ttlDays,
        expireAt,
        authorAlias,
        authorId,
        stats: { create: {} },
      },
      select: { slug: true },
    });

    console.log(`[project][create] slug=${row.slug} source=EXTERNAL_URL ttl=${ttlDays}d`);
    await invalidateTag('projects');
    await invalidateTag('plaza-stats');
    return {
      slug,
      sandboxUrl: url.toString(),
      detailUrl: buildDetailUrl(slug),
      expireAt: expireAt.toISOString(),
      dirPath: '',
    };
  }

  /* ---------- 分支 B：ZIP / 单文件 ---------- */
  const session = await uploadSession.load(uploadId as string);
  const validated = session.validated;
  if (!validated) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '上传内容尚未完成安全校验，请重新上传');
  }
  if (session.status === 'COMMITTED') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '该上传已发布，请勿重复提交');
  }

  const fileList = flattenTree(validated.fileTree);
  const entryFile =
    session.mode === UPLOAD_MODE.SINGLE_FILE
      ? validated.entryFileSuggested
      : resolveEntryFile(input.entryFile, fileList, validated.entryFileSuggested);

  await commitToProject(session.uploadId, slug);

  try {
    const meta: ProjectMeta = {
      slug,
      title,
      sourceType: session.mode === UPLOAD_MODE.ZIP ? SOURCE_TYPE.ZIP : SOURCE_TYPE.SINGLE_FILE,
      entryFile,
      fileCount: validated.fileCount,
      sizeBytes: validated.sizeBytes,
      uploadedAt: new Date().toISOString(),
      expireAt: expireAt.toISOString(),
      ignoredFiles: validated.ignoredFiles,
      kernelVersion: KERNEL_VERSION,
    };
    await writeMeta(slug, meta);
    await writeCover(slug, buildCoverSvg(slug, title));

    await prisma.project.create({
      data: {
        slug,
        title,
        summary,
        description,
        coverUrl: `/api/covers/${slug}.svg`,
        sourceType: meta.sourceType,
        externalUrl: null,
        entryFile,
        fileCount: validated.fileCount,
        sizeBytes: validated.sizeBytes,
        visibility,
        status: PROJECT_STATUS.ACTIVE,
        ttlDays,
        expireAt,
        authorAlias,
        authorId,
        stats: { create: {} },
      },
      select: { id: true },
    });
  } catch (error) {
    // 回滚：库没写成，磁盘目录不能留
    await removeProjectDir(slug).catch(() => undefined);
    console.error(`[project][create][rollback] slug=${slug}`, error);
    throw error;
  }

  await uploadSession.markCommitted(session.uploadId);
  await uploadSession.discard(session.uploadId).catch(() => undefined);

  console.log(
    `[project][create] slug=${slug} source=${session.mode} files=${validated.fileCount} ttl=${ttlDays}d`,
  );

  await invalidateTag('projects');
  await invalidateTag('plaza-stats');
  return {
    slug,
    sandboxUrl: buildSandboxUrl(slug),
    detailUrl: buildDetailUrl(slug),
    expireAt: expireAt.toISOString(),
    dirPath: resolveProjectDir(slug),
  };
}

/* ============================================================================
   3) 查询
   ========================================================================== */

/** 归一化分页参数。 */
function normalizePaging(query: ProjectListQuery): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const rawSize = Math.floor(Number(query.pageSize) || DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page, pageSize };
}

/**
 * 广场列表：仅 PUBLIC + ACTIVE。
 *
 * 排序：
 *   - `new`（默认）→ pinned 优先，其次 createdAt 倒序；
 *   - `votes` → pinned 优先，其次 ProjectStats.voteCount 倒序；
 *   - `hot` 尚无真实热度分，P1 未实现（UI 置灰），降级为按 createdAt 排序。
 */
export async function list(query: ProjectListQuery = {}): Promise<PagedResult<ProjectDTO>> {
  const listCacheKey = [
    'projects-list',
    {
      q: query.q ?? '',
      sort: query.sort ?? 'new',
      campaign: query.campaign ?? '',
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
    },
  ];
  return cached(() => listImpl(query), listCacheKey, { tags: ['projects'], revalidate: 60 });
}
async function listImpl(query: ProjectListQuery = {}): Promise<PagedResult<ProjectDTO>> {
  const { page, pageSize } = normalizePaging(query);
  const keyword = trimOrUndefined(query.q);
  const campaignSlug = trimOrUndefined(query.campaign);

  const where = {
    visibility: VISIBILITY.PUBLIC,
    status: PROJECT_STATUS.ACTIVE,
    ...(keyword
      ? {
          OR: [{ title: { contains: keyword } }, { summary: { contains: keyword } }],
        }
      : {}),
    // P1 活动模块：广场按活动筛选 → 只返回报名了该活动（joined）的作品
    ...(campaignSlug
      ? { campaigns: { some: { status: 'joined', campaign: { slug: campaignSlug } } } }
      : {}),
  };

  const orderBy: Prisma.ProjectOrderByWithRelationInput[] =
    query.sort === 'votes'
      ? [{ pinned: 'desc' }, { stats: { voteCount: 'desc' } }, { createdAt: 'desc' }]
      : [{ pinned: 'desc' }, { createdAt: 'desc' }];

  const [total, rows] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      include: PROJECT_INCLUDE,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // P3 补：收藏数（Favorite 表按项目聚合，当前页一次取齐）
  const projectRows = rows as unknown as ProjectRow[];
  const favoriteGroups = await prisma.favorite.groupBy({
    by: ['projectId'],
    where: { projectId: { in: projectRows.map((r) => r.id) } },
    _count: { projectId: true },
  });
  const favoriteMap = new Map(favoriteGroups.map((g) => [g.projectId, g._count.projectId]));

  return {
    items: projectRows.map((row) => toDTO(row, favoriteMap.get(row.id) ?? 0)),
    page,
    pageSize,
    total,
  };
}

/** 广场 Hero 的三个统计数字。 */
export interface PlazaStats {
  /** 在线（PUBLIC + ACTIVE）作品数。 */
  projects: number;
  /** 累计浏览量。 */
  views: number;
  /** 累计占用字节。 */
  bytes: number;
}

/**
 * 统计广场概览数字。
 *
 * 只统计公开且在线的作品 —— 回收站里的东西不该出现在门面数字上。
 */
export async function stats(): Promise<PlazaStats> {
  return cached(statsImpl, ['plaza-stats'], { tags: ['plaza-stats'], revalidate: 30 });
}
async function statsImpl(): Promise<PlazaStats> {
  const where = { visibility: VISIBILITY.PUBLIC, status: PROJECT_STATUS.ACTIVE };

  // viewCount 在 ProjectStats 上（1:1 关联），因此拆成两次聚合，
  // 用同一份 where 过滤关联侧，保证两个数字口径一致。
  const [projects, sizeAgg, viewAgg] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.aggregate({ where, _sum: { sizeBytes: true } }),
    prisma.projectStats.aggregate({ where: { project: { is: where } }, _sum: { viewCount: true } }),
  ]);

  return {
    projects,
    views: viewAgg._sum?.viewCount ?? 0,
    bytes: sizeAgg._sum?.sizeBytes ?? 0,
  };
}

/**
 * 我发布的全部作品（P3 个人空间 Tab 1）。
 *
 * 直查 `authorId`，**不经过 getBySlug**（getBySlug 对 PURGED / BLOCKED / PRIVATE 一律拒绝）：
 * 个人空间需要展示回收站/已清除状态 —— 全部状态与可见性（含 ARCHIVED/PURGED/BLOCKED/PRIVATE）
 * 都返回，由展示层区分：ACTIVE/ARCHIVED 可进详情/操作，PURGED/BLOCKED 只展示状态徽章。
 * 排序：createdAt desc。
 */
export async function listMine(userId: string): Promise<ProjectDTO[]> {
  const rows = await prisma.project.findMany({
    where: { authorId: userId },
    include: PROJECT_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  return (rows as unknown as ProjectRow[]).map(toDTO);
}

/**
 * 个人空间计数卡聚合（P3 §1.8 / §7.5；P3.5 扩展 storageBytes）。
 *
 * 口径 = **作者全部作品（含回收站/已清除）**，与 Tab 1 展示一致：
 *   - projectCount = COUNT(Project where authorId)
 *   - voteCount / viewCount = SUM(ProjectStats.voteCount / viewCount) over 作者全部作品
 *   - storageBytes = SUM(Project.sizeBytes where authorId)（P3.5 存储面板口径；
 *     PURGED 作品在 purge 任务中 sizeBytes 已归 0，故 SUM 天然等于磁盘占用）
 */
export async function myStats(userId: string): Promise<MyProjectStats> {
  const where = { authorId: userId };
  const [projectCount, statsAgg, sizeAgg] = await Promise.all([
    prisma.project.count({ where }),
    prisma.projectStats.aggregate({
      where: { project: { is: where } },
      _sum: { voteCount: true, viewCount: true },
    }),
    prisma.project.aggregate({ where, _sum: { sizeBytes: true } }),
  ]);
  return {
    projectCount,
    voteCount: statsAgg._sum?.voteCount ?? 0,
    viewCount: statsAgg._sum?.viewCount ?? 0,
    storageBytes: sizeAgg._sum?.sizeBytes ?? 0,
  };
}

/**
 * 排行榜：全站票数总榜（P1 只做 global + all-time）。
 *
 * 口径：`visibility=PUBLIC` + `status=ACTIVE` + `stats.voteCount > 0`，
 * 按 `voteCount desc, createdAt desc` 排序 —— 不暴露 UNLISTED / PRIVATE / ARCHIVED。
 *
 * ⬆️ 生产化替换点（docs/03 §3.3）：P3 接 Redis ZSET 实时榜时，
 *     本函数降级为「DB 兜底 / 重算基准」，并由 `rank-recalc` 任务（每 5 分钟）
 *     以 DB 为准校准 ZSET；`scope=global|campaign` 与 `range=day|week|all`
 *     参数届时再加，函数签名保持不变（新增可选参数即可）。
 *
 * @param limit 返回条数，默认 12（P1 单页足够；分页在 P2 补 `page` 参数）。
 */
export async function rank(limit = 12): Promise<ProjectDTO[]> {
  return cached(() => rankImpl(limit), ['rank', limit], { tags: ['rank'], revalidate: 60 });
}
async function rankImpl(limit = 12): Promise<ProjectDTO[]> {
  const take = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(Number(limit) || 12)));
  const rows = await prisma.project.findMany({
    where: {
      visibility: VISIBILITY.PUBLIC,
      status: PROJECT_STATUS.ACTIVE,
      stats: { voteCount: { gt: 0 } },
    },
    include: PROJECT_INCLUDE,
    orderBy: [{ stats: { voteCount: 'desc' } }, { createdAt: 'desc' }],
    take,
  });
  return (rows as unknown as ProjectRow[]).map(toDTO);
}

/** 读取原始行（含关联），不做任何可见性判断。 */
async function findRow(slug: string): Promise<ProjectRow | null> {
  if (typeof slug !== 'string' || slug.trim() === '') return null;
  const row = await prisma.project.findUnique({ where: { slug }, include: PROJECT_INCLUDE });
  return (row as unknown as ProjectRow) ?? null;
}

/** `getBySlug` 的可选行为。 */
export interface GetOptions {
  /** 是否允许返回 PRIVATE 作品（详情页 / 状态页内部使用）。默认 false。 */
  allowPrivate?: boolean;
  /** 是否允许返回 ARCHIVED 作品（状态页需要展示回收站倒计时）。默认 false。 */
  allowArchived?: boolean;
}

/**
 * 按短码取作品。
 *
 * @throws AppError NOT_FOUND 不存在 / PRIVATE 且未放行 / 已 PURGED
 * @throws AppError GONE_ARCHIVED 已归档且未放行（附带 purgeAt）
 */
export async function getBySlug(slug: string, options: GetOptions = {}): Promise<ProjectDTO> {
  const row = await findRow(slug);
  if (!row) throw new AppError(ERROR_CODE.NOT_FOUND);

  if (row.status === PROJECT_STATUS.PURGED || row.status === PROJECT_STATUS.BLOCKED) {
    throw new AppError(ERROR_CODE.NOT_FOUND);
  }
  if (row.visibility === VISIBILITY.PRIVATE && !options.allowPrivate) {
    // 与「不存在」表现一致，不泄漏存在性
    throw new AppError(ERROR_CODE.NOT_FOUND);
  }
  if (row.status === PROJECT_STATUS.ARCHIVED && !options.allowArchived) {
    throw new AppError(ERROR_CODE.GONE_ARCHIVED, undefined, {
      slug: row.slug,
      purgeAt: row.purgeAt ? row.purgeAt.toISOString() : null,
    });
  }

  const favoriteCount = await prisma.favorite.count({ where: { projectId: row.id } });
  return toDTO(row, favoriteCount);
}

/** 状态页专用：任何状态都能拿到，取不到返回 null（不抛错）。 */
export async function peek(slug: string): Promise<ProjectDTO | null> {
  const row = await findRow(slug);
  return row ? toDTO(row) : null;
}

/**
 * 沙箱访问专用：返回渲染所需的最小信息。
 *
 * 归档 / 清除 / 私有一律拒绝，理由由调用方翻译成对应状态页。
 */
export async function resolveForSandbox(
  slug: string,
): Promise<{ ok: true; entryFile: string; sourceType: SourceType } | { ok: false; reason: 'NOT_FOUND' | 'ARCHIVED' }> {
  const row = await findRow(slug);
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  if (row.status === PROJECT_STATUS.ARCHIVED) return { ok: false, reason: 'ARCHIVED' };
  if (row.status !== PROJECT_STATUS.ACTIVE) return { ok: false, reason: 'NOT_FOUND' };
  if (row.visibility === VISIBILITY.PRIVATE) return { ok: false, reason: 'NOT_FOUND' };
  return { ok: true, entryFile: row.entryFile, sourceType: row.sourceType as SourceType };
}

/* ============================================================================
   4) 变更
   ========================================================================== */

/**
 * 局部更新。slug / sourceType / entryFile 不可变更。
 *
 * @throws AppError NOT_FOUND / VALIDATION_FAILED
 */
export async function patch(slug: string, input: PatchProjectInput): Promise<ProjectDTO> {
  const row = await findRow(slug);
  if (!row || row.status === PROJECT_STATUS.PURGED) throw new AppError(ERROR_CODE.NOT_FOUND);

  const data: Record<string, unknown> = {};

  if (input.title !== undefined) {
    data.title = normalizeTitle(input.title);
  }
  if (input.summary !== undefined) {
    const summary = trimOrNull(input.summary);
    assertLength(summary, MAX_SUMMARY_LEN, '一句话简介');
    data.summary = summary;
  }
  if (input.description !== undefined) {
    const description = trimOrNull(input.description);
    assertLength(description, MAX_DESCRIPTION_LEN, '详细介绍');
    data.description = description;
  }
  if (input.authorAlias !== undefined) {
    const alias = trimOrNull(input.authorAlias);
    assertLength(alias, MAX_AUTHOR_ALIAS_LEN, '作者昵称');
    data.authorAlias = alias;
  }
  if (input.visibility !== undefined) {
    data.visibility = normalizeVisibility(input.visibility);
  }

  if (Object.keys(data).length === 0) {
    return toDTO(row);
  }

  const updated = await prisma.project.update({ where: { slug }, data, include: PROJECT_INCLUDE });
  console.log(`[project][patch] slug=${slug} fields=${Object.keys(data).join(',')}`);
  await invalidateTag('projects');
  return toDTO(updated as unknown as ProjectRow);
}

/**
 * 续期：在「当前到期时间」与「现在」的较晚者上叠加 ttlDays。
 *
 * 已归档的作品续期即复活：status 回到 ACTIVE，清空 archivedAt / purgeAt。
 * 磁盘目录仍在（回收站期内未物理删除）才允许复活。
 *
 * @throws AppError NOT_FOUND / VALIDATION_FAILED
 */
export async function renew(slug: string, ttlDays: number): Promise<ProjectDTO> {
  const days = normalizeTtlDays(ttlDays);
  const row = await findRow(slug);
  if (!row || row.status === PROJECT_STATUS.PURGED) throw new AppError(ERROR_CODE.NOT_FOUND);

  const base = Math.max(Date.now(), row.expireAt.getTime());
  const nextExpireAt = new Date(base + days * MS_PER_DAY);

  const updated = await prisma.project.update({
    where: { slug },
    data: {
      ttlDays: days,
      expireAt: nextExpireAt,
      status: PROJECT_STATUS.ACTIVE,
      archivedAt: null,
      purgeAt: null,
    },
    include: PROJECT_INCLUDE,
  });

  console.log(`[project][renew] slug=${slug} +${days}d expireAt=${nextExpireAt.toISOString()}`);
  await invalidateTag('projects');
  return toDTO(updated as unknown as ProjectRow);
}

/**
 * 软删除：进入回收站（ARCHIVED），磁盘目录保留 RECYCLE_BIN_DAYS 天。
 *
 * @throws AppError NOT_FOUND
 */
export async function softDelete(slug: string): Promise<ProjectDTO> {
  const row = await findRow(slug);
  if (!row || row.status === PROJECT_STATUS.PURGED) throw new AppError(ERROR_CODE.NOT_FOUND);

  const now = new Date();
  const updated = await prisma.project.update({
    where: { slug },
    data: {
      status: PROJECT_STATUS.ARCHIVED,
      archivedAt: now,
      purgeAt: new Date(now.getTime() + RECYCLE_BIN_DAYS * MS_PER_DAY),
    },
    include: PROJECT_INCLUDE,
  });

  console.log(`[project][soft-delete] slug=${slug} purgeAt=${updated.purgeAt?.toISOString() ?? '-'}`);
  await invalidateTag('projects');
  return toDTO(updated as unknown as ProjectRow);
}

/**
 * 浏览量 +1。失败不影响主流程，仅打日志。
 *
 * P0 无去重（P1 再接 uniqueVisitor / deepView）。
 */
export async function incrementView(slug: string): Promise<void> {
  try {
    const row = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
    if (!row) return;
    await prisma.projectStats.upsert({
      where: { projectId: row.id },
      update: { viewCount: { increment: 1 } },
      create: { projectId: row.id, viewCount: 1 },
    });
  } catch (error) {
    console.warn(`[project][view] 统计失败 slug=${slug}`, error);
  }
}
