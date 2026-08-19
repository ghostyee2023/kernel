/**
 * DELETE /api/admin/tags/[id]/projects/[projectId] —— 解除作品与标签的关联。
 *
 * 鉴权：requireAdmin。
 */

import { requireAdmin } from '@/lib/auth';
import { ok, toErrorResponse } from '@/lib/response';
import { removeProjectTag } from '@/lib/tag-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; projectId: string }> };

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  try {
    await requireAdmin();
    const { id, projectId } = await context.params;
    await removeProjectTag(projectId, id);
    return ok({ removed: true });
  } catch (error) {
    return toErrorResponse(error, 'admin:tags:unlink');
  }
}
