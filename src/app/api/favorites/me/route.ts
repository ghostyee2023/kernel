/**
 * GET /api/favorites/me —— 我收藏的作品列表（P3 个人空间）。
 *
 * 返回 `[{ projectId, createdAt }]`（createdAt desc，对齐 /api/votes/me 形态），
 * 前端用于批量渲染已收藏态（广场卡片 / 收藏 Tab）。
 * 需登录：未登录 401 NOT_LOGGED_IN。
 */

import { requireUser } from '@/lib/auth';
import * as favoriteService from '@/lib/favorite-service';
import { ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireUser();
    const items = await favoriteService.myFavorites(session.userId);
    return ok(items);
  } catch (error) {
    return toErrorResponse(error, 'favorites:me');
  }
}
