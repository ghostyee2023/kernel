/**
 * GET /api/favorites —— 当前登录用户已收藏的作品 id 列表。
 *
 * 用于 P1 流式：广场卡片的收藏星标改为客户端挂载后批量拉取一次，
 * 让首页 SSR 不再阻塞在 per-user 的 favorites 查询上（壳先出、星标后补）。
 *
 * 未登录返回 `{ ids: [] }`（不报错，前端据此不点亮任何星标）。
 */

import { getSession } from '@/lib/auth';
import { ok, toErrorResponse } from '@/lib/response';
import * as favoriteService from '@/lib/favorite-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return ok({ ids: [] });
    const ids = await favoriteService.myFavoriteIds(session.userId);
    return ok({ ids });
  } catch (error) {
    return toErrorResponse(error, 'favorites:list');
  }
}
