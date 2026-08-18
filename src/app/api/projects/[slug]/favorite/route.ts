/**
 * POST /api/projects/{slug}/favorite —— 收藏 toggle（P3 个人空间）。
 *
 * 单端点 toggle：未收藏 → `{favorited:true}`；已收藏 → `{favorited:false}`（§7.3）。
 * 需登录：未登录 401 NOT_LOGGED_IN；PRIVATE / PURGED / BLOCKED / 不存在统一 404
 * （与 getBySlug 一致，不泄漏存在性）。
 *
 * 无 body（路径 slug 即目标）；业务规则全在 favorite-service。
 */

import type { NextRequest } from 'next/server';

import { requireUser } from '@/lib/auth';
import * as favoriteService from '@/lib/favorite-service';
import { ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Next 15 起动态参数为 Promise。 */
type Context = { params: Promise<{ slug: string }> };

export async function POST(_request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const session = await requireUser();
    const result = await favoriteService.toggle(slug, session.userId);
    return ok(result);
  } catch (error) {
    return toErrorResponse(error, 'projects:favorite');
  }
}
