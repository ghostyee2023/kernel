/**
 * 活动领域服务（P1 活动模块）。
 *
 * 设计真源：docs/P1-活动模块设计.md §1.2 / §1.3 / §1.4 / §三。
 *
 * 铁律：
 *   1. Route Handler 只做「解析入参 → 鉴权 → 调服务 → ok()/toErrorResponse()」，
 *      所有业务规则收敛在本文件，禁止在路由里写 prisma 查询。
 *   2. **唯一权威 = `computeStatus(campaign, now)`**：展示（广场/详情/后台列表）
 *      与写操作（join/vote）都使用它；DB `status` 仅是管理员设定值。
 *   3. 报名幂等：joined 重复报名返回 alreadyJoined=true；removed/rejected 后
 *      重复报名抛 CAMP_ALREADY_JOINED（管理员移除是处置动作，作者不可绕过重报）。
 *   4. `draft` 不对公开侧暴露（广场不展示、详情 404，不泄漏存在性）。
 *   5. 时间顺序校验：`collectEndAt <= voteStartAt(可空) <= voteEndAt`。
 */

import { Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';

import { writeAudit } from './audit';
import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_MAX_PAGE_SIZE,
  AUDIT_ACTION,
  BASE58_ALPHABET,
  CAMPAIGN_SLUG_PATTERN,
  CAMPAIGN_SLUG_PREFIX,
  CAMPAIGN_SLUG_RANDOM_LEN,
  CAMPAIGN_STATUS,
  DEFAULT_ALLOW_SELF_VOTE,
  DEFAULT_MAX_VOTES_PER_USER,
  DEFAULT_PAGE_SIZE,
  DEFAULT_VOTE_WEIGHT,
  MAX_CAMPAIGN_DESCRIPTION_LEN,
  MAX_CAMPAIGN_TITLE_LEN,
  MAX_PAGE_SIZE,
  MAX_VOTES_OPTIONS,
  PROJECT_CAMPAIGN_STATUS,
  PROJECT_STATUS,
  RESERVED_SLUGS,
  SLUG_MAX_RETRY,
  VISIBILITY,
  type CampaignStatus,
} from './constants';
import { prisma } from './prisma';
import { AppError, ERROR_CODE } from './response';
import { buildDetailUrl } from './sandbox';
import type {
  CampaignBadgeDTO,
  CampaignCardDTO,
  CampaignDetailDTO,
  CampaignDTO,
  CampaignInput,
  CampaignJoinResult,
  CampaignProjectItem,
  CampaignRankItemDTO,
  JoinedCampaignDTO,
  PagedResult,
  ProjectCardLite,
  QuotaInfo,
} from './types';

/* ============================================================================
   0) 行 → DTO
   ========================================================================== */

/** 与 Campaign 表对应的最小结构化行类型（避免依赖生成态 Prisma 类型）。 */
export interface CampaignRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  status: string;
  collectEndAt: Date | null;
  voteStartAt: Date | null;
  voteEndAt: Date | null;
  maxVotesPerUser: number;
  allowSelfVote: boolean;
  voteWeight: number;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 带聚合计数的卡片行（`_count.projects` = joined 作品数，`_count.votes` = 活动内票数）。 */
interface CampaignCardRow extends CampaignRow {
  _count: { projects: number; votes: number };
}

/**
 * 懒计算活动有效状态（P1 唯一权威，纯函数便于单测）。
 *
 * 规则（docs/P1-活动模块设计.md §1.3）：
 *   - stored `ended` → 恒 `ended`（终态不自动复活）；
 *   - stored `draft` → 恒 `draft`（草稿不自动推进）；
 *   - stored `collecting`：voteStartAt 空视为 = collectEndAt；
 *     now >= collectEndAt 且 now >= voteStartAt → `voting`，否则 `collecting`；
 *   - stored `voting`：now >= voteEndAt → `ended`，否则 `voting`。
 *
 * @param campaign 至少携带 status / collectEndAt / voteStartAt / voteEndAt。
 * @param now 当前时间，缺省 Date.now()（便于测试注入）。
 */
export function computeStatus(
  campaign: Pick<CampaignRow, 'status' | 'collectEndAt' | 'voteStartAt' | 'voteEndAt'>,
  now: Date = new Date(),
): CampaignStatus {
  if (campaign.status === CAMPAIGN_STATUS.ENDED) return CAMPAIGN_STATUS.ENDED;
  if (campaign.status === CAMPAIGN_STATUS.DRAFT) return CAMPAIGN_STATUS.DRAFT;

  if (campaign.status === CAMPAIGN_STATUS.COLLECTING) {
    const voteStart = campaign.voteStartAt ?? campaign.collectEndAt;
    if (
      campaign.collectEndAt &&
      voteStart &&
      now.getTime() >= campaign.collectEndAt.getTime() &&
      now.getTime() >= voteStart.getTime()
    ) {
      return CAMPAIGN_STATUS.VOTING;
    }
    return CAMPAIGN_STATUS.COLLECTING;
  }

  if (campaign.status === CAMPAIGN_STATUS.VOTING) {
    if (campaign.voteEndAt && now.getTime() >= campaign.voteEndAt.getTime()) {
      return CAMPAIGN_STATUS.ENDED;
    }
    return CAMPAIGN_STATUS.VOTING;
  }

  return campaign.status as CampaignStatus;
}

/** 把 Campaign 行转为基础 DTO。 */
function toDTO(row: CampaignRow, effective?: CampaignStatus): CampaignDTO {
  const status = effective ?? computeStatus(row);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    coverUrl: row.coverUrl,
    status,
    storedStatus: row.status as CampaignStatus,
    collectEndAt: row.collectEndAt ? row.collectEndAt.toISOString() : null,
    voteStartAt: row.voteStartAt ? row.voteStartAt.toISOString() : null,
    voteEndAt: row.voteEndAt ? row.voteEndAt.toISOString() : null,
    maxVotesPerUser: row.maxVotesPerUser,
    allowSelfVote: row.allowSelfVote,
    voteWeight: row.voteWeight,
    authorId: row.authorId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 把带聚合计数的卡片行转为卡片 DTO。 */
function toCardDTO(row: CampaignCardRow): CampaignCardDTO {
  return {
    ...toDTO(row),
    projectCount: row._count.projects,
    voteCount: row._count.votes,
  };
}

/** prisma 查询卡片时统一携带的聚合计数（projects 只数 joined；votes 只数有效票，作废票不计入活动累计）。 */
const CARD_COUNT = {
  _count: {
    select: {
      projects: { where: { status: PROJECT_CAMPAIGN_STATUS.JOINED } },
      votes: { where: { valid: true } },
    },
  },
} as const;

/** 把作品行转为精简卡片 DTO（活动网格 / 活动榜用）。 */
function toProjectLite(project: {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  coverUrl: string | null;
  authorAlias: string | null;
  authorId: string;
  author: { nickname: string } | null;
  stats: { voteCount: number } | null;
}): ProjectCardLite {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    summary: project.summary,
    coverUrl: project.coverUrl,
    authorName: project.authorAlias ?? project.author?.nickname ?? '匿名创作者',
    authorId: project.authorId,
    detailUrl: buildDetailUrl(project.slug),
    voteCount: project.stats?.voteCount ?? 0,
  };
}

/** 统计活动内各作品的票数（Vote where campaignId AND valid=true groupBy projectId）。 */
async function campaignVoteMap(campaignId: string): Promise<Map<string, number>> {
  const rows = await prisma.vote.groupBy({
    by: ['projectId'],
    where: { campaignId, valid: true },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.projectId, row._count._all]));
}

/* ============================================================================
   1) 入参校验
   ========================================================================== */

/** 去首尾空白；空串归一为 null（用于可清空字段）。 */
function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** 校验一段文本的长度。 */
function assertLength(value: string | null | undefined, max: number, label: string): void {
  if (value != null && value.length > max) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, `${label}不能超过 ${max} 个字符`);
  }
}

/** 校验活动标题：必填 + 长度。 */
function normalizeTitle(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请填写活动标题');
  }
  const title = value.trim();
  assertLength(title, MAX_CAMPAIGN_TITLE_LEN, '活动标题');
  return title;
}

/** 解析 ISO 8601 UTC 时间字符串 → Date；空串/null 归一为 null（用于可清空字段）。 */
function parseISODate(value: unknown, label: string): Date | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, `${label}必须是 ISO 8601 时间字符串`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, `${label}格式不正确`);
  }
  return date;
}

/** 校验每人限票数：必须落在可选档位。 */
function normalizeMaxVotes(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || !MAX_VOTES_OPTIONS.includes(num)) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, `每人限票只能是 ${MAX_VOTES_OPTIONS.join(' / ')} 票`);
  }
  return num;
}

/** 校验评委加权：正整数（本轮恒 1，字段落库供后续）。 */
function normalizeVoteWeight(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num < 1) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '评委加权必须是正整数');
  }
  return num;
}

/** 校验活动状态取值。 */
function normalizeStatus(value: unknown): CampaignStatus {
  const list: readonly string[] = [
    CAMPAIGN_STATUS.DRAFT,
    CAMPAIGN_STATUS.COLLECTING,
    CAMPAIGN_STATUS.VOTING,
    CAMPAIGN_STATUS.ENDED,
  ];
  if (typeof value !== 'string' || !list.includes(value)) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '活动状态取值不合法');
  }
  return value as CampaignStatus;
}

/** 校验活动 slug：留空返回 undefined（自动生成）；格式 + 保留词校验。 */
function normalizeSlug(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '活动短码格式不正确');
  }
  const slug = value.trim().toLowerCase();
  if (!CAMPAIGN_SLUG_PATTERN.test(slug)) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '活动短码只能包含小写字母、数字与连字符（2-32 位）');
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new AppError(ERROR_CODE.SLUG_RESERVED, '该短码为系统保留词，请更换');
  }
  return slug;
}

/** 生成活动短码：`camp-{Base58 6位}`，跳过保留词并做一次前置探测。 */
async function generateSlug(): Promise<string> {
  const nano = customAlphabet(BASE58_ALPHABET, CAMPAIGN_SLUG_RANDOM_LEN);
  for (let attempt = 1; attempt <= SLUG_MAX_RETRY; attempt += 1) {
    const candidate = `${CAMPAIGN_SLUG_PREFIX}${nano()}`;
    const hit = await prisma.campaign.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!hit) return candidate;
    console.warn(`[campaign][slug-conflict] attempt=${attempt} candidate=${candidate}`);
  }
  throw new AppError(ERROR_CODE.SLUG_CONFLICT, '活动短码生成冲突，请稍后重试');
}

/**
 * 归一化 create/patch 入参（合并当前行后做时间顺序校验）。
 *
 * @param input 请求入参。
 * @param current 已有活动行（patch 时提供；create 时为 undefined）。
 * @returns 可直接写入 Prisma 的更新数据（不含 id/slug/authorId/createdAt/updatedAt）。
 */
async function buildUpdateData(
  input: CampaignInput,
  current?: CampaignRow,
): Promise<{
  title: string;
  description: string | null;
  coverUrl: string | null;
  collectEndAt: Date | null;
  voteStartAt: Date | null;
  voteEndAt: Date | null;
  maxVotesPerUser: number;
  allowSelfVote: boolean;
  voteWeight: number;
  status: CampaignStatus;
}> {
  const title = input.title !== undefined ? normalizeTitle(input.title) : current?.title;
  if (!title) throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请填写活动标题');

  const description = input.description !== undefined ? trimOrNull(input.description) : (current?.description ?? null);
  const coverUrl = input.coverUrl !== undefined ? trimOrNull(input.coverUrl) : (current?.coverUrl ?? null);
  const collectEndAt =
    input.collectEndAt !== undefined ? parseISODate(input.collectEndAt, '征集截止时间') : (current?.collectEndAt ?? null);
  const voteStartAt =
    input.voteStartAt !== undefined ? parseISODate(input.voteStartAt, '投票开始时间') : (current?.voteStartAt ?? null);
  const voteEndAt =
    input.voteEndAt !== undefined ? parseISODate(input.voteEndAt, '投票结束时间') : (current?.voteEndAt ?? null);
  const maxVotesPerUser =
    input.maxVotesPerUser !== undefined ? normalizeMaxVotes(input.maxVotesPerUser) : (current?.maxVotesPerUser ?? DEFAULT_MAX_VOTES_PER_USER);
  const allowSelfVote =
    input.allowSelfVote !== undefined ? Boolean(input.allowSelfVote) : (current?.allowSelfVote ?? DEFAULT_ALLOW_SELF_VOTE);
  const voteWeight =
    input.voteWeight !== undefined ? normalizeVoteWeight(input.voteWeight) : (current?.voteWeight ?? DEFAULT_VOTE_WEIGHT);
  const status =
    input.status !== undefined
      ? normalizeStatus(input.status)
      : ((current?.status as CampaignStatus | undefined) ?? CAMPAIGN_STATUS.DRAFT);

  // 时间顺序校验（§1.5）：collectEndAt <= voteStartAt(可空) <= voteEndAt，且 voteEndAt > collectEndAt
  if (collectEndAt && voteStartAt && voteStartAt.getTime() < collectEndAt.getTime()) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '投票开始时间不能早于征集截止时间');
  }
  if (voteStartAt && voteEndAt && voteEndAt.getTime() < voteStartAt.getTime()) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '投票结束时间不能早于投票开始时间');
  }
  if (collectEndAt && voteEndAt && voteEndAt.getTime() <= collectEndAt.getTime()) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '投票结束时间必须晚于征集截止时间');
  }

  return { title, description, coverUrl, collectEndAt, voteStartAt, voteEndAt, maxVotesPerUser, allowSelfVote, voteWeight, status };
}

/* ============================================================================
   2) 查询（公开 + 后台共用）
   ========================================================================== */

/** 活动列表查询参数。 */
export interface CampaignListQuery {
  /** 单值过滤（按存储状态）；缺省全部非草稿。 */
  status?: string;
  page?: number;
  pageSize?: number;
  /** 后台列表：包含 draft；缺省仅公开（非草稿），pageSize 默认 20/上限 100。 */
  includeDraft?: boolean;
}

/** 归一化分页参数。 */
function normalizePaging(query: CampaignListQuery): { page: number; pageSize: number } {
  if (query.includeDraft) {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const rawSize = Math.floor(Number(query.pageSize) || ADMIN_DEFAULT_PAGE_SIZE);
    const pageSize = Math.min(ADMIN_MAX_PAGE_SIZE, Math.max(1, rawSize));
    return { page, pageSize };
  }
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const rawSize = Math.floor(Number(query.pageSize) || DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page, pageSize };
}

/**
 * 活动列表（广场 / 后台共用）。
 *
 * - 公开（includeDraft=false）：只返回存储状态非 draft 的活动；返回的 `status`
 *   为懒计算 effective（collecting 到点自动显示 voting / ended）。
 * - 后台（includeDraft=true）：包含 draft，分页默认 20/上限 100。
 */
export async function list(query: CampaignListQuery = {}): Promise<PagedResult<CampaignCardDTO>> {
  const { page, pageSize } = normalizePaging(query);
  const where: Prisma.CampaignWhereInput = {
    ...(query.includeDraft ? {} : { status: { not: CAMPAIGN_STATUS.DRAFT } }),
    ...(query.status ? { status: query.status } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.campaign.count({ where }),
    prisma.campaign.findMany({
      where,
      include: CARD_COUNT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items = (rows as unknown as CampaignCardRow[])
    .map(toCardDTO)
    .filter((item) => (query.includeDraft ? true : item.status !== CAMPAIGN_STATUS.DRAFT));

  return { items, page, pageSize, total };
}

/**
 * 可筛活动列表（广场 FilterBar 用）：effective 为 voting / ended 的活动。
 * collecting 活动作品量少且未开投，不参与广场筛选（§八 Q7）。
 */
export async function listSelectable(): Promise<CampaignCardDTO[]> {
  const rows = await prisma.campaign.findMany({
    where: { status: { in: [CAMPAIGN_STATUS.COLLECTING, CAMPAIGN_STATUS.VOTING, CAMPAIGN_STATUS.ENDED] } },
    include: CARD_COUNT,
    orderBy: { createdAt: 'desc' },
  });
  return (rows as unknown as CampaignCardRow[])
    .map(toCardDTO)
    .filter((item) => item.status === CAMPAIGN_STATUS.VOTING || item.status === CAMPAIGN_STATUS.ENDED);
}

/** 按 id 取活动（后台编辑用；draft 也可返回）。 */
export async function getById(id: string): Promise<CampaignDTO> {
  if (typeof id !== 'string' || id.trim() === '') throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);
  const row = await prisma.campaign.findUnique({ where: { id } });
  if (!row) throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);
  return toDTO(row as unknown as CampaignRow);
}

/** 按 slug 取活动详情（公开）；draft / 不存在统一 404，不泄漏存在性。 */
export async function getBySlug(slug: string): Promise<CampaignDetailDTO> {
  const row = await prisma.campaign.findUnique({ where: { slug }, include: CARD_COUNT });
  if (!row) throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);
  const card = toCardDTO(row as unknown as CampaignCardRow);
  if (card.status === CAMPAIGN_STATUS.DRAFT) throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);

  const projects = await listJoinedProjects(card.id);
  return { ...card, projects };
}

/** 活动已报名作品列表（后台编辑页 / 活动详情共用；不依赖有效状态，draft 也可查看）。 */
export async function listJoinedProjects(campaignId: string): Promise<CampaignProjectItem[]> {
  const members = await prisma.projectCampaign.findMany({
    where: { campaignId, status: PROJECT_CAMPAIGN_STATUS.JOINED },
    include: { project: { include: { author: true, stats: true } } },
    orderBy: { joinedAt: 'asc' },
  });

  const voteMap = await campaignVoteMap(campaignId);
  return members
    .map((member) => ({
      project: toProjectLite(member.project),
      campaignVoteCount: voteMap.get(member.projectId) ?? 0,
      joinedAt: member.joinedAt.toISOString(),
    }))
    .sort((a, b) => b.campaignVoteCount - a.campaignVoteCount || a.joinedAt.localeCompare(b.joinedAt));
}

/** 作品所属活动（详情页 badge；非 draft 才返回）。 */
export async function getProjectCampaigns(projectId: string): Promise<CampaignBadgeDTO[]> {
  const rows = await prisma.projectCampaign.findMany({
    where: { projectId, status: PROJECT_CAMPAIGN_STATUS.JOINED },
    include: { campaign: true },
    orderBy: { joinedAt: 'desc' },
  });
  const out: CampaignBadgeDTO[] = [];
  for (const row of rows) {
    const effective = computeStatus(row.campaign as unknown as CampaignRow);
    if (effective === CAMPAIGN_STATUS.DRAFT) continue;
    out.push({
      id: row.campaign.id,
      slug: row.campaign.slug,
      title: row.campaign.title,
      status: effective,
      joinedAt: row.joinedAt.toISOString(),
    });
  }
  return out;
}

/* ============================================================================
   3) 创建 / 更新（后台）
   ========================================================================== */

/** 创建活动：初始 status='draft'、authorId=actorId；slug 留空自动生成。 */
export async function create(input: CampaignInput, actorId: string): Promise<CampaignDTO> {
  const data = await buildUpdateData(input);
  const slug = normalizeSlug(input.slug) ?? (await generateSlug());

  let row: CampaignRow;
  try {
    const created = await prisma.campaign.create({
      data: { ...data, slug, authorId: actorId },
    });
    row = created as unknown as CampaignRow;
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw new AppError(ERROR_CODE.SLUG_CONFLICT, '活动短码已存在，请更换');
    }
    throw error;
  }

  await writeAudit({
    actorId,
    action: AUDIT_ACTION.CAMPAIGN_CREATE,
    targetType: 'campaign',
    targetId: row.id,
    detail: `创建活动 ${row.slug}（${row.title}）`,
    meta: { slug: row.slug, title: row.title, status: row.status },
  });
  console.log(`[campaign][create] slug=${row.slug} title=${row.title} status=${row.status}`);

  return toDTO(row);
}

/** 更新活动规则 / 推进状态（PATCH /api/admin/campaigns/:id）。 */
export async function patch(id: string, input: CampaignInput, actorId: string): Promise<CampaignDTO> {
  if (typeof id !== 'string' || id.trim() === '') throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);
  const row = await prisma.campaign.findUnique({ where: { id } });
  if (!row) throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);

  const before: Record<string, unknown> = {
    title: row.title,
    status: row.status,
    collectEndAt: row.collectEndAt ? row.collectEndAt.toISOString() : null,
    voteStartAt: row.voteStartAt ? row.voteStartAt.toISOString() : null,
    voteEndAt: row.voteEndAt ? row.voteEndAt.toISOString() : null,
    maxVotesPerUser: row.maxVotesPerUser,
    allowSelfVote: row.allowSelfVote,
    voteWeight: row.voteWeight,
  };

  const data = await buildUpdateData(input, row as unknown as CampaignRow);

  let slug = row.slug;
  if (input.slug !== undefined && input.slug !== null && input.slug !== '') {
    slug = normalizeSlug(input.slug) as string;
  }
  if (slug !== row.slug) {
    const hit = await prisma.campaign.findUnique({ where: { slug }, select: { id: true } });
    if (hit && hit.id !== row.id) {
      throw new AppError(ERROR_CODE.SLUG_CONFLICT, '活动短码已存在，请更换');
    }
  }

  const updated = await prisma.campaign.update({
    where: { id },
    data: { ...data, slug },
  });

  const after: Record<string, unknown> = {
    title: updated.title,
    status: updated.status,
    collectEndAt: updated.collectEndAt ? updated.collectEndAt.toISOString() : null,
    voteStartAt: updated.voteStartAt ? updated.voteStartAt.toISOString() : null,
    voteEndAt: updated.voteEndAt ? updated.voteEndAt.toISOString() : null,
    maxVotesPerUser: updated.maxVotesPerUser,
    allowSelfVote: updated.allowSelfVote,
    voteWeight: updated.voteWeight,
    slug: updated.slug,
  };

  await writeAudit({
    actorId,
    action: AUDIT_ACTION.CAMPAIGN_UPDATE,
    targetType: 'campaign',
    targetId: id,
    detail: `更新活动 ${updated.slug}（${updated.title}）`,
    meta: { before, after },
  });
  console.log(`[campaign][update] id=${id} slug=${updated.slug} status=${updated.status}`);

  return toDTO(updated as unknown as CampaignRow);
}

/* ============================================================================
   4) 报名 / 移除报名
   ========================================================================== */

/**
 * 报名（幂等）。
 *
 * - joined 重复报名 → `{ joined:true, alreadyJoined:true }`（对齐「重复操作不报错」铁律）；
 * - removed/rejected 后重复报名 → 409 CAMP_ALREADY_JOINED（管理员处置后不可绕过重报）；
 * - 仅 collecting 且 `now < collectEndAt` 可报名（双重校验，§1.3）。
 */
export async function join(slug: string, projectId: string, userId: string): Promise<CampaignJoinResult> {
  const campaign = await prisma.campaign.findUnique({ where: { slug } });
  if (!campaign) throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);

  const effective = computeStatus(campaign as unknown as CampaignRow);
  const now = new Date();
  // draft 与「不存在」表现一致（不泄漏存在性，§1.5）
  if (effective === CAMPAIGN_STATUS.DRAFT) {
    throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);
  }
  if (effective !== CAMPAIGN_STATUS.COLLECTING || !campaign.collectEndAt || now.getTime() >= campaign.collectEndAt.getTime()) {
    throw new AppError(ERROR_CODE.CAMP_NOT_OPEN, undefined, { status: effective });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, authorId: true, visibility: true, status: true },
  });
  if (!project || project.visibility === VISIBILITY.PRIVATE || project.status !== PROJECT_STATUS.ACTIVE) {
    throw new AppError(ERROR_CODE.NOT_FOUND);
  }
  if (project.authorId !== userId) {
    throw new AppError(ERROR_CODE.FORBIDDEN, '只能报名自己创作的作品');
  }

  const existing = await prisma.projectCampaign.findUnique({
    where: { campaignId_projectId: { campaignId: campaign.id, projectId: project.id } },
  });
  if (existing) {
    if (existing.status === PROJECT_CAMPAIGN_STATUS.JOINED) {
      const count = await prisma.projectCampaign.count({
        where: { campaignId: campaign.id, status: PROJECT_CAMPAIGN_STATUS.JOINED },
      });
      return { joined: true, alreadyJoined: true, projectCount: count };
    }
    throw new AppError(ERROR_CODE.CAMP_ALREADY_JOINED);
  }

  try {
    await prisma.projectCampaign.create({
      data: { campaignId: campaign.id, projectId: project.id, status: PROJECT_CAMPAIGN_STATUS.JOINED },
    });
  } catch (error) {
    // 并发下重复报名撞上复合主键 → 幂等返回
    if ((error as { code?: string }).code === 'P2002') {
      const count = await prisma.projectCampaign.count({
        where: { campaignId: campaign.id, status: PROJECT_CAMPAIGN_STATUS.JOINED },
      });
      return { joined: true, alreadyJoined: true, projectCount: count };
    }
    throw error;
  }

  const count = await prisma.projectCampaign.count({
    where: { campaignId: campaign.id, status: PROJECT_CAMPAIGN_STATUS.JOINED },
  });
  console.log(`[campaign][join] campaign=${campaign.slug} project=${project.id} user=${userId}`);
  return { joined: true, alreadyJoined: false, projectCount: count };
}

/**
 * 移除 / 拒绝报名（后台）。
 *
 * - 未报名 → 404 NOT_FOUND；
 * - 已移除 / 已拒绝 → 幂等返回 `{ removed:true }`（重复操作不报错）；
 * - 只阻止新投票（vote 校验链 ③ 失败）；存量票保留、仍计入活动累计（§八 Q8）。
 */
export async function removeProject(
  id: string,
  projectId: string,
  actorId: string,
): Promise<{ removed: true }> {
  if (typeof id !== 'string' || id.trim() === '') throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);
  const campaign = await prisma.campaign.findUnique({ where: { id }, select: { id: true, slug: true, title: true } });
  if (!campaign) throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);

  const existing = await prisma.projectCampaign.findUnique({
    where: { campaignId_projectId: { campaignId: id, projectId } },
  });
  if (!existing) throw new AppError(ERROR_CODE.NOT_FOUND, '该作品未报名此活动');

  if (existing.status !== PROJECT_CAMPAIGN_STATUS.JOINED) {
    await writeAudit({
      actorId,
      action: AUDIT_ACTION.CAMPAIGN_REMOVE_PROJECT,
      targetType: 'campaign',
      targetId: id,
      detail: `移除活动 ${campaign.slug} 的报名作品（幂等，已是 ${existing.status}）`,
      meta: { campaignSlug: campaign.slug, campaignTitle: campaign.title, projectId, status: existing.status },
    });
    return { removed: true };
  }

  await prisma.projectCampaign.update({
    where: { campaignId_projectId: { campaignId: id, projectId } },
    data: { status: PROJECT_CAMPAIGN_STATUS.REMOVED },
  });

  await writeAudit({
    actorId,
    action: AUDIT_ACTION.CAMPAIGN_REMOVE_PROJECT,
    targetType: 'campaign',
    targetId: id,
    detail: `移除活动 ${campaign.slug} 的报名作品`,
    meta: { campaignSlug: campaign.slug, campaignTitle: campaign.title, projectId, status: PROJECT_CAMPAIGN_STATUS.REMOVED },
  });
  console.log(`[campaign][remove-project] campaign=${campaign.slug} project=${projectId} actor=${actorId}`);

  return { removed: true };
}

/* ============================================================================
   5) 活动榜 / 配额 / 我的作品
   ========================================================================== */

/**
 * 活动榜：活动内票数 desc、joinedAt asc（与活动详情页作品网格排序一致）。
 * 只统计 joined 作品；移除报名后的存量票仍计入（§八 Q8）。
 * draft 活动不对外（与「不存在」一致，404）。
 */
export async function rank(campaignSlug: string, limit = 12): Promise<CampaignRankItemDTO[]> {
  const campaign = await prisma.campaign.findUnique({
    where: { slug: campaignSlug },
    select: { id: true, status: true, collectEndAt: true, voteStartAt: true, voteEndAt: true },
  });
  if (!campaign) throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);
  if (computeStatus(campaign as unknown as CampaignRow) === CAMPAIGN_STATUS.DRAFT) {
    throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);
  }
  const take = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(Number(limit) || 12)));

  const [members, voteMap] = await Promise.all([
    prisma.projectCampaign.findMany({
      where: { campaignId: campaign.id, status: PROJECT_CAMPAIGN_STATUS.JOINED },
      include: { project: { include: { author: true, stats: true } } },
      orderBy: { joinedAt: 'asc' },
      take,
    }),
    campaignVoteMap(campaign.id),
  ]);

  const items = members
    .map((member) => ({
      project: toProjectLite(member.project),
      campaignVoteCount: voteMap.get(member.projectId) ?? 0,
      joinedAt: member.joinedAt.toISOString(),
    }))
    .sort((a, b) => b.campaignVoteCount - a.campaignVoteCount || a.joinedAt.localeCompare(b.joinedAt));

  return items.map((item, index) => ({ rank: index + 1, ...item }));
}

/** 剩余票数（同活动、同用户、跨作品累计；只计有效票，作废票退回额度 Q1）。 */
export async function quota(slug: string, userId: string): Promise<QuotaInfo> {
  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: { id: true, slug: true, maxVotesPerUser: true },
  });
  if (!campaign) throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);

  const used = await prisma.vote.count({ where: { campaignId: campaign.id, userId, valid: true } });
  return {
    campaignId: campaign.id,
    slug: campaign.slug,
    maxVotesPerUser: campaign.maxVotesPerUser,
    used,
    remaining: Math.max(0, campaign.maxVotesPerUser - used),
  };
}

/** 我可报名的作品（本人 ACTIVE、PUBLIC/UNLISTED、且未报名过该活动）。 */
export async function myProjects(userId: string, campaignId: string): Promise<ProjectCardLite[]> {
  const joined = await prisma.projectCampaign.findMany({
    where: { campaignId },
    select: { projectId: true },
  });
  const joinedIds = joined.map((row) => row.projectId);

  const rows = await prisma.project.findMany({
    where: {
      authorId: userId,
      status: PROJECT_STATUS.ACTIVE,
      visibility: { in: [VISIBILITY.PUBLIC, VISIBILITY.UNLISTED] },
      ...(joinedIds.length > 0 ? { id: { notIn: joinedIds } } : {}),
    },
    include: { author: true, stats: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toProjectLite);
}

/** 我（作为作者）已报名该活动的作品 id（详情页标记「已报名」用）。 */
export async function myJoinedIds(userId: string, campaignId: string): Promise<string[]> {
  const rows = await prisma.projectCampaign.findMany({
    where: { campaignId, status: PROJECT_CAMPAIGN_STATUS.JOINED, project: { authorId: userId } },
    select: { projectId: true },
  });
  return rows.map((row) => row.projectId);
}

/**
 * 我参与的活动数（P3.5 概览 KPI「参与活动数」，Q8 纯展示不点击）。
 *
 * 口径：`projectCampaign.groupBy(campaignId)` 的行数 —— 按活动去重，多个作品报名同一场
 * 活动只计 1；只数 `status='joined'`（removed/rejected 不计）。
 */
export async function countJoinedByUser(userId: string): Promise<number> {
  const rows = await prisma.projectCampaign.groupBy({
    by: ['campaignId'],
    where: { status: PROJECT_CAMPAIGN_STATUS.JOINED, project: { authorId: userId } },
  });
  return rows.length;
}

/**
 * 我参与的活动（P3 个人空间 Tab 2，§1.4）。
 *
 * 一次取回 `ProjectCampaign(status=joined, project.authorId=userId)` → Campaign，
 * 按 campaignId 分组 → 每组：
 *   - campaign             → toCardDTO（status 为 computeStatus 懒计算值；projectCount/voteCount 为活动全量）
 *   - myProjectCount       = 组内行数（我报名了该活动的作品数）
 *   - myCampaignVoteCount  = Σ campaignVoteMap(campaignId).get(projectId)（我的作品在该活动的票）
 *
 * 口径说明（§八 Q9）：`voteCount`（活动票累计）= 活动内**全部** joined 作品的票数（与活动详情页一致）；
 * `myCampaignVoteCount` 单独给出「我的作品拿到的票」，两值并列展示。
 * 排序：组内最早 joinedAt 倒序（最近报名在前）。
 */
export async function listJoinedByUser(userId: string): Promise<JoinedCampaignDTO[]> {
  const members = await prisma.projectCampaign.findMany({
    where: { status: PROJECT_CAMPAIGN_STATUS.JOINED, project: { authorId: userId } },
    include: { campaign: { include: CARD_COUNT } },
    orderBy: { joinedAt: 'desc' },
  });

  // 按 campaignId 分组（保留组内最早 joinedAt 作为排序键）
  const groups = new Map<
    string,
    { row: CampaignCardRow; projectIds: string[]; earliestJoinedAt: Date }
  >();
  for (const member of members) {
    const campaignId = member.campaignId;
    const existing = groups.get(campaignId);
    if (existing) {
      existing.projectIds.push(member.projectId);
      if (member.joinedAt.getTime() < existing.earliestJoinedAt.getTime()) {
        existing.earliestJoinedAt = member.joinedAt;
      }
    } else {
      groups.set(campaignId, {
        row: member.campaign as unknown as CampaignCardRow,
        projectIds: [member.projectId],
        earliestJoinedAt: member.joinedAt,
      });
    }
  }

  // 每个活动取一次 campaignVoteMap（并行），聚合我的作品活动票
  const items = await Promise.all(
    [...groups.values()].map(async (group) => {
      const voteMap = await campaignVoteMap(group.row.id);
      const myCampaignVoteCount = group.projectIds.reduce(
        (sum, projectId) => sum + (voteMap.get(projectId) ?? 0),
        0,
      );
      return {
        campaign: toCardDTO(group.row),
        myProjectCount: group.projectIds.length,
        myCampaignVoteCount,
        earliestJoinedAt: group.earliestJoinedAt.getTime(),
      };
    }),
  );

  items.sort((a, b) => b.earliestJoinedAt - a.earliestJoinedAt);
  return items.map(({ campaign, myProjectCount, myCampaignVoteCount }) => ({
    campaign,
    myProjectCount,
    myCampaignVoteCount,
  }));
}
