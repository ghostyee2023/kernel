/**
 * GET /api/admin/tags/[id]/projects —— 标签下的作品列表（后台标签作品管理）。
 *
 * 鉴权：requireAdmin。
 */

import { requireAdmin } from '@/lib/auth';
import { ok, toErrorResponse } from '@/lib/response';
import { listTagProjects } from '@/lib/tag-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const projects = await listTagProjects(id);
    return ok(projects);
  } catch (error) {
    return toErrorResponse(error, 'admin:tags:projects');
  }
}
