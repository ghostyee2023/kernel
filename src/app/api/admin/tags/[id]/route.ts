/**
 * /api/admin/tags/[id]
 *
 *   PATCH  改名 { name }（仅 custom；activity 随活动名同步）
 *   DELETE 删除（仅 custom；ProjectTag 级联清除）
 *
 * 鉴权：requireAdmin。
 */

import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import { deleteTag, patchTagName } from '@/lib/tag-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context): Promise<Response> {
  try {
    await requireAdmin();
    const { id } = await context.params;
    let body: { name?: unknown };
    try {
      body = (await request.json()) as { name?: unknown };
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }
    const tag = await patchTagName(id, body.name);
    return ok(tag);
  } catch (error) {
    return toErrorResponse(error, 'admin:tags:patch');
  }
}

export async function DELETE(_request: NextRequest, context: Context): Promise<Response> {
  try {
    await requireAdmin();
    const { id } = await context.params;
    await deleteTag(id);
    return ok({ deleted: true });
  } catch (error) {
    return toErrorResponse(error, 'admin:tags:delete');
  }
}
