/**
 * POST /api/admin/tags/[id]/reorder —— 上移/下移排序。
 *
 * body: { direction: 'up' | 'down' }
 * 返回调整后的标签列表（含作品数）。
 *
 * 鉴权：requireAdmin。
 */

import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import { reorderTag } from '@/lib/tag-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  try {
    await requireAdmin();
    const { id } = await context.params;
    let body: { direction?: unknown };
    try {
      body = (await request.json()) as { direction?: unknown };
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }
    const direction = body.direction === 'up' ? 'up' : body.direction === 'down' ? 'down' : null;
    if (!direction) throw new AppError(ERROR_CODE.VALIDATION_FAILED, 'direction 必须是 up 或 down');

    const tags = await reorderTag(id, direction);
    return ok(tags);
  } catch (error) {
    return toErrorResponse(error, 'admin:tags:reorder');
  }
}
