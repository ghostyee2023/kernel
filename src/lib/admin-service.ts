/**
 * 后台领域服务（P2 后台管理模块）。
 *
 * 设计真源：docs/P2-后台管理设计.md §1.4 / §3 / §四（AdminService）。
 *
 * 铁律：
 *   1. Route Handler 只做「解析入参 → 鉴权 → 调服务 → ok()/toErrorResponse()」，
 *      所有后台业务规则收敛在本文件，禁止在路由里写 prisma 查询。
 *   2. `batchOps` 是作品**唯一写操作入口**：逐条 try/catch、单条失败入 `results`、
 *      成功即 `writeAudit`；purge 调 `storage.removeProjectDir`（route 层不碰 fs）。
 *   3. `setUserBan` 校验：禁止封禁 ADMIN/SUPER_ADMIN 与自身（Q6，抛 FORBIDDEN）。
 *   4. 分页：page 从 1 起、pageSize 默认 20、上限 100（ADMIN_DEFAULT/MAX_PAGE_SIZE）。
 */

import { Prisma } from '@prisma/client';

import { writeAudit } from './audit';
import {
  ADMIN_BATCH_MAX_IDS,
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_MAX_PAGE_SIZE,
  AUDIT_ACTION,
  PROJECT_STATUS,
  ROLE,
  TTL_OPTIONS,
  USER_STATUS,
  VISIBILITY,
  type Visibility,
} from './constants';
import { prisma } from './prisma';
import * as projectService from './project-service';
import { AppError, ERROR_CODE } from './response';
import { removeProjectDir } from './storage';
import type {
  AdminBatchInput,
  AdminBatchItemResult,
  AdminBatchOperation,
  AdminBatchResult,
  AdminProjectDTO,
  AdminUserDTO,
  CleanupLogDTO,
  OverviewMetrics,
  PagedResult,
} from './types';

/* ============================================================================
   0) 通用工具
   ========================================================================== */

/** 与 `projectService.toDTO` 的 ProjectRow 结构对齐的本地行类型（含 pinned）。 */
interface AdminProjectRow {
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

/** 后台分页归一化：page ≥ 1；pageSize 默认 20、上限 100。 */
function normalizeAdminPaging(page?: number, pageSize?: number): { page: number; pageSize: number } {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const rawSize = Math.floor(Number(pageSize) || ADMIN_DEFAULT_PAGE_SIZE);
  const size = Math.min(ADMIN_MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page: p, pageSize: size };
}

/** 逗号分隔的多值筛选拆分为数组（去空）。 */
function splitFilter(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** 把 prisma 行转成后台作品 DTO（复用 project-service.toDTO）。 */
function toAdminProjectDTO(row: AdminProjectRow): AdminProjectDTO {
  return projectService.toDTO(row as unknown as Parameters<typeof projectService.toDTO>[0]);
}

/** 校验批量操作类型。 */
function normalizeBatchOperation(value: unknown): AdminBatchOperation {
  const operations: readonly AdminBatchOperation[] = [
    'block',
    'unblock',
    'purge',
    'renew',
    'visibility',
    'pin',
    'unpin',
  ];
  if (typeof value !== 'string' || !operations.includes(value as AdminBatchOperation)) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '操作类型不合法');
  }
  return value as AdminBatchOperation;
}

/** 校验 ids：非空数组、1..100 条、全部为非空字符串、去重。 */
function normalizeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, 'ids 必须是非空数组');
  }
  if (ids.length === 0) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请至少选择一条记录');
  }
  if (ids.length > ADMIN_BATCH_MAX_IDS) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, `单次操作最多 ${ADMIN_BATCH_MAX_IDS} 条`);
  }
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, 'ids 包含非法条目');
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** 校验 operation 依赖的 payload 字段。 */
function validateBatchPayload(operation: AdminBatchOperation, payload: AdminBatchInput['payload']): void {
  if (operation === 'renew') {
    const ttlDays = payload?.ttlDays;
    if (typeof ttlDays !== 'number' || !TTL_OPTIONS.includes(ttlDays)) {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, `续期必须指定有效期（${TTL_OPTIONS.join(' / ')} 天）`);
    }
  }
  if (operation === 'visibility') {
    const value = payload?.visibility;
    const list: readonly string[] = [VISIBILITY.PUBLIC, VISIBILITY.UNLISTED, VISIBILITY.PRIVATE];
    if (typeof value !== 'string' || !list.includes(value)) {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '可见性取值不合法');
    }
  }
}

/** 解析 CleanupLog.detail（JSON 字符串 → 对象）。 */
function parseDetail(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/* ============================================================================
   1) 概览
   ========================================================================== */

/**
 * 概览指标（6 卡数据源）。
 *
 * 口径：`votes` = ProjectStats.voteCount 全量求和；
 * `storageBytes` = Project.sizeBytes 全量求和（≈磁盘用量）。
 */
export async function overview(): Promise<OverviewMetrics> {
  const [projectCounts, votesAgg, userCounts, storageAgg] = await Promise.all([
    prisma.project.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.projectStats.aggregate({ _sum: { voteCount: true } }),
    prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.project.aggregate({ _sum: { sizeBytes: true } }),
  ]);

  const statusMap = new Map<string, number>(projectCounts.map((row) => [row.status, row._count._all]));
  const userStatusMap = new Map<string, number>(userCounts.map((row) => [row.status, row._count._all]));

  return {
    projects: {
      total: projectCounts.reduce((sum, row) => sum + row._count._all, 0),
      active: statusMap.get(PROJECT_STATUS.ACTIVE) ?? 0,
      archived: statusMap.get(PROJECT_STATUS.ARCHIVED) ?? 0,
      blocked: statusMap.get(PROJECT_STATUS.BLOCKED) ?? 0,
      purged: statusMap.get(PROJECT_STATUS.PURGED) ?? 0,
    },
    votes: votesAgg._sum?.voteCount ?? 0,
    users: {
      total: userCounts.reduce((sum, row) => sum + row._count._all, 0),
      banned: userStatusMap.get(USER_STATUS.BANNED) ?? 0,
    },
    storageBytes: storageAgg._sum?.sizeBytes ?? 0,
  };
}

/* ============================================================================
   2) 作品列表（全量，含私密/已归档/已封禁）
   ========================================================================== */

/** 后台作品列表查询参数。 */
export interface AdminProjectListQuery {
  /** 单值或多值逗号分隔（如 `ACTIVE,BLOCKED`）；缺省=全部。 */
  status?: string;
  visibility?: string;
  /** slug / title / authorName 模糊。 */
  q?: string;
  /** createdAt | expireAt | voteCount，缺省 createdAt desc。 */
  sort?: 'createdAt' | 'expireAt' | 'voteCount';
  page?: number;
  pageSize?: number;
}

export async function listProjects(query: AdminProjectListQuery = {}): Promise<PagedResult<AdminProjectDTO>> {
  const { page, pageSize } = normalizeAdminPaging(query.page, query.pageSize);
  const keyword = query.q?.trim() ?? '';
  const statusList = splitFilter(query.status);
  const visibilityList = splitFilter(query.visibility);

  const where: Prisma.ProjectWhereInput = {
    ...(statusList.length > 0 ? { status: { in: statusList } } : {}),
    ...(visibilityList.length > 0 ? { visibility: { in: visibilityList } } : {}),
    ...(keyword
      ? {
          OR: [
            { slug: { contains: keyword } },
            { title: { contains: keyword } },
            { author: { nickname: { contains: keyword } } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.ProjectOrderByWithRelationInput[] =
    query.sort === 'expireAt'
      ? [{ expireAt: 'desc' }, { createdAt: 'desc' }]
      : query.sort === 'voteCount'
        ? [{ stats: { voteCount: 'desc' } }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }];

  const [total, rows] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      include: { author: true, stats: true },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: (rows as unknown as AdminProjectRow[]).map(toAdminProjectDTO),
    page,
    pageSize,
    total,
  };
}

/* ============================================================================
   3) 批量操作（唯一写操作入口）
   ========================================================================== */

/**
 * 批量操作：逐条 try/catch，单条失败不中断整批，成功即写 AuditLog。
 *
 * @param input { operation, ids, payload }。
 * @param actor 当前管理员会话（写入审计 actorId）。
 */
export async function batchOps(input: AdminBatchInput, actor: { userId: string }): Promise<AdminBatchResult> {
  const operation = normalizeBatchOperation(input.operation);
  const ids = normalizeIds(input.ids);
  validateBatchPayload(operation, input.payload);

  const results: AdminBatchItemResult[] = [];
  let successCount = 0;
  let failCount = 0;

  for (const id of ids) {
    try {
      const item = await applyBatchOperation(operation, id, input.payload, actor.userId);
      results.push(item);
      if (item.ok) successCount += 1;
      else failCount += 1;
    } catch (error) {
      failCount += 1;
      const code = error instanceof AppError ? error.code : ERROR_CODE.INTERNAL_ERROR;
      const message = error instanceof Error ? error.message : undefined;
      results.push({ id, ok: false, code, message });
      if (code === ERROR_CODE.INTERNAL_ERROR) {
        console.error(`[admin][batch] id=${id} op=${operation}`, error);
      }
    }
  }

  console.log(
    `[admin][batch] op=${operation} ids=${ids.length} ok=${successCount} fail=${failCount}`,
  );
  return { operation, successCount, failCount, results };
}

/** 对单个 id 应用一次后台操作；成功返回该条结果并写 AuditLog，失败抛错由 batchOps 捕获。 */
async function applyBatchOperation(
  operation: AdminBatchOperation,
  id: string,
  payload: AdminBatchInput['payload'],
  actorId: string,
): Promise<AdminBatchItemResult> {
  const row = await prisma.project.findUnique({ where: { id } });
  if (!row) throw new AppError(ERROR_CODE.NOT_FOUND, '作品不存在');

  const before = {
    status: row.status,
    visibility: row.visibility,
    pinned: row.pinned,
    expireAt: row.expireAt.toISOString(),
  };

  switch (operation) {
    case 'block': {
      if (row.status === PROJECT_STATUS.BLOCKED) return { id, ok: true, slug: row.slug };
      await prisma.project.update({ where: { id }, data: { status: PROJECT_STATUS.BLOCKED } });
      await writeAudit({
        actorId,
        action: AUDIT_ACTION.PROJECT_BLOCK,
        targetType: 'project',
        targetId: id,
        detail: `下架作品 ${row.slug}（${row.title}）`,
        meta: { slug: row.slug, title: row.title, before, after: { status: PROJECT_STATUS.BLOCKED } },
      });
      return { id, ok: true, slug: row.slug };
    }

    case 'unblock': {
      if (row.status !== PROJECT_STATUS.BLOCKED) {
        throw new AppError(ERROR_CODE.VALIDATION_FAILED, '仅 BLOCKED 作品可恢复');
      }
      await prisma.project.update({
        where: { id },
        data: { status: PROJECT_STATUS.ACTIVE, archivedAt: null, purgeAt: null },
      });
      await writeAudit({
        actorId,
        action: AUDIT_ACTION.PROJECT_UNBLOCK,
        targetType: 'project',
        targetId: id,
        detail: `恢复作品 ${row.slug}（${row.title}）`,
        meta: { slug: row.slug, title: row.title, before, after: { status: PROJECT_STATUS.ACTIVE } },
      });
      return { id, ok: true, slug: row.slug };
    }

    case 'purge': {
      const freedBytes = await removeProjectDir(row.slug);
      await prisma.project.update({
        where: { id },
        data: { status: PROJECT_STATUS.PURGED, fileCount: 0, sizeBytes: 0 },
      });
      await writeAudit({
        actorId,
        action: AUDIT_ACTION.PROJECT_PURGE,
        targetType: 'project',
        targetId: id,
        detail: `物理删除作品 ${row.slug}（${row.title}），释放 ${freedBytes} 字节`,
        meta: { slug: row.slug, title: row.title, freedBytes, before, after: { status: PROJECT_STATUS.PURGED } },
      });
      return { id, ok: true, slug: row.slug };
    }

    case 'renew': {
      const ttlDays = payload?.ttlDays;
      if (typeof ttlDays !== 'number' || !TTL_OPTIONS.includes(ttlDays)) {
        throw new AppError(ERROR_CODE.VALIDATION_FAILED, `续期必须指定有效期（${TTL_OPTIONS.join(' / ')} 天）`);
      }
      // 复用 projectService.renew：在「当前到期时间」与「现在」的较晚者上叠加，ARCHIVED 自动复活
      const dto = await projectService.renew(row.slug, ttlDays);
      await writeAudit({
        actorId,
        action: AUDIT_ACTION.PROJECT_RENEW,
        targetType: 'project',
        targetId: id,
        detail: `续期作品 ${row.slug}（${row.title}）+${ttlDays} 天`,
        meta: { slug: row.slug, title: row.title, ttlDays, before, after: { status: dto.status, expireAt: dto.expireAt } },
      });
      return { id, ok: true, slug: row.slug };
    }

    case 'visibility': {
      const value = payload?.visibility;
      if (typeof value !== 'string' || ![VISIBILITY.PUBLIC, VISIBILITY.UNLISTED, VISIBILITY.PRIVATE].includes(value)) {
        throw new AppError(ERROR_CODE.VALIDATION_FAILED, '可见性取值不合法');
      }
      const visibility = value as Visibility;
      await prisma.project.update({ where: { id }, data: { visibility } });
      await writeAudit({
        actorId,
        action: AUDIT_ACTION.PROJECT_VISIBILITY,
        targetType: 'project',
        targetId: id,
        detail: `修改作品 ${row.slug}（${row.title}）可见性为 ${visibility}`,
        meta: { slug: row.slug, title: row.title, before, after: { visibility } },
      });
      return { id, ok: true, slug: row.slug };
    }

    case 'pin':
    case 'unpin': {
      const pinned = operation === 'pin';
      await prisma.project.update({ where: { id }, data: { pinned } });
      await writeAudit({
        actorId,
        action: pinned ? AUDIT_ACTION.PROJECT_PIN : AUDIT_ACTION.PROJECT_UNPIN,
        targetType: 'project',
        targetId: id,
        detail: `${pinned ? '置顶' : '取消置顶'}作品 ${row.slug}（${row.title}）`,
        meta: { slug: row.slug, title: row.title, before, after: { pinned } },
      });
      return { id, ok: true, slug: row.slug };
    }
  }
}

/* ============================================================================
   4) 用户列表
   ========================================================================== */

/** 后台用户列表查询参数。 */
export interface AdminUserListQuery {
  /** username / nickname 模糊。 */
  q?: string;
  role?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function listUsers(query: AdminUserListQuery = {}): Promise<PagedResult<AdminUserDTO>> {
  const { page, pageSize } = normalizeAdminPaging(query.page, query.pageSize);
  const keyword = query.q?.trim() ?? '';
  const role = query.role?.trim() ?? '';
  const status = query.status?.trim() ?? '';

  const where: Prisma.UserWhereInput = {
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(keyword
      ? { OR: [{ username: { contains: keyword } }, { nickname: { contains: keyword } }] }
      : {}),
  };

  const [total, rows, counts] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    // 一次取齐全部作者的作品数（后台列表数量级小，全量 groupBy 可接受）
    prisma.project.groupBy({ by: ['authorId'], _count: { _all: true } }),
  ]);

  const countMap = new Map<string, number>(counts.map((row) => [row.authorId, row._count._all]));

  return {
    items: rows.map((row) => ({
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      role: row.role,
      status: row.status,
      projectCount: countMap.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
    })),
    page,
    pageSize,
    total,
  };
}

/* ============================================================================
   5) 封禁 / 解封
   ========================================================================== */

/**
 * 封禁 / 解封用户。
 *
 * Q6 边界：禁止对 ADMIN/SUPER_ADMIN 执行 ban；禁止对自己执行 ban（均抛 FORBIDDEN）。
 * 解封不受角色限制（管理员可解封任何人）。
 *
 * @returns { id, status: 'BANNED' | 'ACTIVE' }。
 */
export async function setUserBan(
  id: string,
  action: 'ban' | 'unban',
  actor: { userId: string },
): Promise<{ id: string; status: string }> {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '缺少用户标识');
  }
  if (action !== 'ban' && action !== 'unban') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '操作类型不合法');
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError(ERROR_CODE.NOT_FOUND, '用户不存在');

  if (action === 'ban') {
    if (user.role === ROLE.ADMIN || user.role === ROLE.SUPER_ADMIN) {
      throw new AppError(ERROR_CODE.FORBIDDEN, '不能封禁管理员账号');
    }
    if (user.id === actor.userId) {
      throw new AppError(ERROR_CODE.FORBIDDEN, '不能封禁自己');
    }
  }

  const nextStatus = action === 'ban' ? USER_STATUS.BANNED : USER_STATUS.ACTIVE;
  const updated = await prisma.user.update({
    where: { id },
    data: { status: nextStatus },
    select: { id: true, status: true },
  });

  await writeAudit({
    actorId: actor.userId,
    action: action === 'ban' ? AUDIT_ACTION.USER_BAN : AUDIT_ACTION.USER_UNBAN,
    targetType: 'user',
    targetId: id,
    detail: `${action === 'ban' ? '封禁' : '解封'}用户 ${user.username ?? user.nickname}`,
    meta: {
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      before: { status: user.status },
      after: { status: nextStatus },
    },
  });

  console.log(`[admin][user-${action}] id=${id} status=${nextStatus}`);
  return { id: updated.id, status: updated.status };
}

/* ============================================================================
   6) 清理日志
   ========================================================================== */

/** 清理日志查询参数。 */
export interface AdminCleanupLogQuery {
  action?: string;
  /** 'true' | 'false'。 */
  success?: string;
  page?: number;
  pageSize?: number;
}

export async function listCleanupLogs(query: AdminCleanupLogQuery = {}): Promise<PagedResult<CleanupLogDTO>> {
  const { page, pageSize } = normalizeAdminPaging(query.page, query.pageSize);
  const action = query.action?.trim() ?? '';
  const successRaw = query.success;

  const where: Prisma.CleanupLogWhereInput = {
    ...(action ? { action } : {}),
    ...(successRaw === 'true' ? { success: true } : successRaw === 'false' ? { success: false } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.cleanupLog.count({ where }),
    prisma.cleanupLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      batchId: row.batchId,
      action: row.action,
      projectId: row.projectId,
      freedBytes: row.freedBytes,
      success: row.success,
      message: row.message,
      detail: parseDetail(row.detail),
      createdAt: row.createdAt.toISOString(),
    })),
    page,
    pageSize,
    total,
  };
}
