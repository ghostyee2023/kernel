/**
 * GET /api/tags —— 公开标签列表（发布/编辑页选择用）。
 *
 * 返回全部标签（custom + activity），按 sortOrder 排序。
 */

import { listPublicTags } from '@/lib/tag-service';
import { ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const tags = await listPublicTags();
    return ok(tags);
  } catch (error) {
    return toErrorResponse(error, 'tags:list');
  }
}
