/**
 * 标签服务（P3 标签系统）。
 *
 * 职责：
 *   1. 公开标签列表（发布/编辑页选择用，按 sortOrder 排序）；
 *   2. 后台 CRUD：创建 / 改名 / 排序（上移下移，swap sortOrder）/ 删除（仅 custom）；
 *   3. 活动联动：活动创建/改名时自动 upsert 同源标签（kind=activity，不可手动删）；
 *   4. 作品关联：set（replace 语义，≤5）/ add（幂等）/ remove / 按标签列作品。
 *
 * 标签 slug 策略（保持稳定唯一，不依赖中文）：
 *   - custom：`t-{8位随机hex}`（创建时生成）；
 *   - activity：`a-{campaignId}`（cuid，稳定可复现，筛选链接不变）。
 */

import { randomBytes } from 'node:crypto';

import { MAX_PROJECT_TAGS, TAG_KIND } from './constants';
import { prisma } from './prisma';
import { AppError, ERROR_CODE } from './response';
import type { AdminTagDTO, AdminTagListQuery, TagDTO } from './types';

/** 标签名长度上限。 */
const MAX_TAG_NAME_LEN = 12;

/** 行 → 对外 DTO。 */
function toTagDTO(row: { id: string; name: string; slug: string; kind: string; createdAt: Date }): TagDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 行 → 后台 DTO（含作品数）。 */
function toAdminDTO(row: {
  id: string;
  name: string;
  slug: string;
  kind: string;
  activityId: string | null;
  sortOrder: number;
  createdAt: Date;
  _count?: { projects: number };
}): AdminTagDTO {
  return {
    ...toTagDTO(row),
    activityId: row.activityId,
    sortOrder: row.sortOrder,
    projectCount: row._count?.projects ?? 0,
  };
}

/** 下一个排序号（追加到末尾）。 */
async function nextSortOrder(): Promise<number> {
  const last = await prisma.tag.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
  return (last?.sortOrder ?? 0) + 1;
}

/** 校验标签名。 */
function normalizeName(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '') throw new AppError(ERROR_CODE.VALIDATION_FAILED, '标签名不能为空');
  if (trimmed.length > MAX_TAG_NAME_LEN) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, `标签名最多 ${MAX_TAG_NAME_LEN} 个字`);
  }
  return trimmed;
}

/* ============================================================================
   公开
   ========================================================================== */

/** 公开标签列表（按 sortOrder，含活动标签）。 */
export async function listPublicTags(): Promise<TagDTO[]> {
  const rows = await prisma.tag.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toTagDTO);
}

/* ============================================================================
   后台 CRUD
   ========================================================================== */

/** 后台标签列表（可过滤 kind / 关键词，含作品数）。 */
export async function listAdminTags(query: AdminTagListQuery = {}): Promise<AdminTagDTO[]> {
  const where: Record<string, unknown> = {};
  if (query.kind && query.kind !== '') where.kind = query.kind;
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q !== '') {
    where.OR = [{ name: { contains: q } }, { slug: { contains: q } }];
  }
  const rows = await prisma.tag.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { _count: { select: { projects: true } } },
  });
  return rows.map(toAdminDTO);
}

/** 创建自定义标签。 */
export async function createTag(name: unknown): Promise<AdminTagDTO> {
  const normalized = normalizeName(name);
  const row = await prisma.tag.create({
    data: {
      name: normalized,
      slug: `t-${randomBytes(4).toString('hex')}`,
      kind: TAG_KIND.CUSTOM,
      sortOrder: await nextSortOrder(),
    },
    include: { _count: { select: { projects: true } } },
  });
  return toAdminDTO(row);
}

/** 改名（仅 custom；activity 随活动名同步）。 */
export async function patchTagName(id: string, name: unknown): Promise<AdminTagDTO> {
  const row = await prisma.tag.findUnique({ where: { id } });
  if (!row) throw new AppError(ERROR_CODE.NOT_FOUND);
  if (row.kind === TAG_KIND.ACTIVITY) {
    throw new AppError(ERROR_CODE.FORBIDDEN, '活动标签随活动名自动同步，不能手动改名');
  }
  const normalized = normalizeName(name);
  const updated = await prisma.tag.update({
    where: { id },
    data: { name: normalized },
    include: { _count: { select: { projects: true } } },
  });
  return toAdminDTO(updated);
}

/** 上移/下移排序（与相邻标签交换 sortOrder），返回调整后的列表。 */
export async function reorderTag(id: string, direction: 'up' | 'down'): Promise<AdminTagDTO[]> {
  const row = await prisma.tag.findUnique({ where: { id } });
  if (!row) throw new AppError(ERROR_CODE.NOT_FOUND);

  const siblings = await prisma.tag.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  const index = siblings.findIndex((item) => item.id === id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= siblings.length) {
    return listAdminTags(); // 已在边界，返回原列表
  }

  const a = siblings[index];
  const b = siblings[target];
  await prisma.$transaction([
    prisma.tag.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } }),
    prisma.tag.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } }),
  ]);
  return listAdminTags();
}

/** 删除标签（仅 custom；ProjectTag 级联清除）。 */
export async function deleteTag(id: string): Promise<void> {
  const row = await prisma.tag.findUnique({ where: { id } });
  if (!row) throw new AppError(ERROR_CODE.NOT_FOUND);
  if (row.kind === TAG_KIND.ACTIVITY) {
    throw new AppError(ERROR_CODE.FORBIDDEN, '活动标签随活动生命周期管理，不能手动删除');
  }
  await prisma.tag.delete({ where: { id } });
}

/* ============================================================================
   活动联动（由 campaign-service 在创建/改名后调用）
   ========================================================================== */

/** 同步活动标签（upsert：按 activityId 幂等，name 跟随活动名）。 */
export async function syncActivityTag(campaign: { id: string; title: string }): Promise<void> {
  await prisma.tag.upsert({
    where: { activityId: campaign.id },
    update: { name: campaign.title },
    create: {
      name: campaign.title,
      slug: `a-${campaign.id}`,
      kind: TAG_KIND.ACTIVITY,
      activityId: campaign.id,
      sortOrder: await nextSortOrder(),
    },
  });
}

/* ============================================================================
   作品关联
   ========================================================================== */

/** 全量替换作品标签（≤5，去重；tagIds 为 undefined 时不动）。 */
export async function setProjectTags(projectId: string, tagIds: string[] | undefined): Promise<void> {
  if (!Array.isArray(tagIds)) return;
  const unique = [...new Set(tagIds)].slice(0, MAX_PROJECT_TAGS);
  if (unique.length > 0) {
    const count = await prisma.tag.count({ where: { id: { in: unique } } });
    if (count !== unique.length) {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '包含不存在的标签');
    }
  }
  await prisma.$transaction([
    prisma.projectTag.deleteMany({ where: { projectId } }),
    ...(unique.length > 0
      ? [prisma.projectTag.createMany({ data: unique.map((tagId) => ({ projectId, tagId })) })]
      : []),
  ]);
}

/** 幂等添加单个标签关联（报名活动自动打活动标签用）。 */
export async function addProjectTag(projectId: string, tagId: string): Promise<void> {
  await prisma.projectTag.upsert({
    where: { projectId_tagId: { projectId, tagId } },
    update: {},
    create: { projectId, tagId },
  });
}

/** 移除单个标签关联（取消报名 / 后台解除关联用）。 */
export async function removeProjectTag(projectId: string, tagId: string): Promise<void> {
  await prisma.projectTag.deleteMany({ where: { projectId, tagId } });
}

/** 查询标签下所有作品（后台标签作品管理；含状态便于过滤）。 */
export async function listTagProjects(tagId: string): Promise<Array<{ id: string; slug: string; title: string; status: string }>> {
  const rows = await prisma.projectTag.findMany({
    where: { tagId },
    select: { project: { select: { id: true, slug: true, title: true, status: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => row.project);
}
