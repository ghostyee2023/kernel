/**
 * 收藏领域服务（P3 个人空间）。
 *
 * 设计真源：docs/P3-个人空间设计.md §1.2 / §1.3 / §7.3 / §7.4。
 *
 * 铁律：
 *   1. Route Handler 只做「解析入参 → 鉴权 → 调服务 → ok()/toErrorResponse()」，
 *      所有业务规则收敛在本文件，禁止在路由里写 prisma 查询。
 *   2. toggle 幂等：未收藏 → `{favorited:true}`、已收藏 → `{favorited:false}`；
 *      并发双击撞 `@@unique([userId, projectId])`（P2002）→ 幂等返回 `{favorited:true}`，
 *      与 vote-service「重复操作不报错」铁律一致。
 *   3. **不校验 owner、不做自收藏限制**：任何登录用户可收藏任何可见作品（读者行为，与投票一致）。
 *   4. 可见性口径：PRIVATE / PURGED / BLOCKED / 不存在 → 统一 NOT_FOUND（不泄漏存在性）；
 *      ARCHIVED 允许（回收站内仍可访问状态页）。
 *   5. 读侧口径：`list(userId)` 过滤 PURGED / BLOCKED / PRIVATE，ARCHIVED 保留展示；
 *      作品行物理删除时 `onDelete: Cascade` 自动清理收藏行。
 */

import { PROJECT_STATUS, VISIBILITY } from './constants';
import { prisma } from './prisma';
import * as projectService from './project-service';
import { AppError, ERROR_CODE } from './response';
import type { FavoriteItem, ProjectDTO } from './types';

/** 收藏 toggle 结果。 */
export interface FavoriteToggleResult {
  favorited: boolean;
}

/** 与 `projectService.toDTO` 入参对应的最小结构化行类型。 */
type ProjectRow = Parameters<typeof projectService.toDTO>[0];

/** prisma 查询收藏行时统一携带的作品关联（对齐 project-service PROJECT_INCLUDE）。 */
const FAVORITE_PROJECT_INCLUDE = { project: { include: { author: true, stats: true } } } as const;

/**
 * 收藏 toggle（单端点，客户端零分支）。
 *
 * 顺序：可见性判定（peek + 过滤）→ findUnique → 建/删 → 返回 `{favorited}`。
 *
 * @throws AppError NOT_FOUND 不存在 / PRIVATE / PURGED / BLOCKED（与 getBySlug 一致）
 */
export async function toggle(slug: string, userId: string): Promise<FavoriteToggleResult> {
  // ① 可见性判定：ARCHIVED 允许（可进状态页）；PRIVATE/PURGED/BLOCKED/不存在 → 404
  const project = await projectService.peek(slug);
  if (
    !project ||
    project.visibility === VISIBILITY.PRIVATE ||
    project.status === PROJECT_STATUS.PURGED ||
    project.status === PROJECT_STATUS.BLOCKED
  ) {
    throw new AppError(ERROR_CODE.NOT_FOUND);
  }

  // ② 已收藏 → 删 → {favorited:false}
  const existing = await prisma.favorite.findUnique({
    where: { userId_projectId: { userId, projectId: project.id } },
    select: { id: true },
  });
  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    console.log(`[favorite][delete] projectId=${project.id} user=${userId}`);
    return { favorited: false };
  }

  // ③ 未收藏 → 建 → {favorited:true}；并发撞唯一约束幂等返回
  try {
    await prisma.favorite.create({ data: { userId, projectId: project.id } });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      console.log(`[favorite][create][idempotent] projectId=${project.id} user=${userId}`);
      return { favorited: true };
    }
    throw error;
  }
  console.log(`[favorite][create] projectId=${project.id} user=${userId}`);
  return { favorited: true };
}

/**
 * 我收藏的作品列表（GET /api/favorites/me）。
 *
 * 返回 `[{ projectId, createdAt }]`（createdAt desc），供广场/详情页 SSR 批量渲染已收藏态。
 */
export async function myFavorites(userId: string): Promise<FavoriteItem[]> {
  const rows = await prisma.favorite.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { projectId: true, createdAt: true },
  });
  return rows.map((row) => ({ projectId: row.projectId, createdAt: row.createdAt.toISOString() }));
}

/** 我收藏的作品 id 列表（广场 SSR 批量渲染已收藏态；收藏 Tab 的 id 集合）。 */
export async function myFavoriteIds(userId: string): Promise<string[]> {
  const rows = await prisma.favorite.findMany({
    where: { userId },
    select: { projectId: true },
  });
  return rows.map((row) => row.projectId);
}

/** 当前用户是否已收藏某作品（详情页 SSR 用）。 */
export async function hasFavorited(projectId: string, userId: string): Promise<boolean> {
  const row = await prisma.favorite.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * 我收藏的作品列表（收藏 Tab 用）。
 *
 * 读侧口径（§7.4）：只返回 `status NOT IN (PURGED, BLOCKED)` 且 `visibility != PRIVATE` 的
 * 收藏作品（对齐「能看才能继续看」）；ARCHIVED 保留展示（可进状态页）。
 * 排序：收藏时间 createdAt desc。
 */
export async function list(userId: string): Promise<ProjectDTO[]> {
  const rows = await prisma.favorite.findMany({
    where: { userId },
    include: FAVORITE_PROJECT_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  return rows
    .filter((row) => {
      const project = row.project;
      return (
        project.status !== PROJECT_STATUS.PURGED &&
        project.status !== PROJECT_STATUS.BLOCKED &&
        project.visibility !== VISIBILITY.PRIVATE
      );
    })
    .map((row) => projectService.toDTO(row.project as unknown as ProjectRow));
}

/** 我的收藏条数（dashboard 计数卡，口径 = COUNT(Favorite where userId)，与 Tab 3 条数一致）。 */
export async function count(userId: string): Promise<number> {
  return prisma.favorite.count({ where: { userId } });
}
