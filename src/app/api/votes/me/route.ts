/**
 * GET /api/votes/me —— 我投过的作品列表。
 *
 * 返回 `[{ projectId, createdAt }]`，前端用于批量渲染已投状态。
 * 需登录：未登录返回 401 NOT_LOGGED_IN。
 */

import { requireUser } from '@/lib/auth';
import { ok, toErrorResponse } from '@/lib/response';
import * as voteService from '@/lib/vote-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireUser();
    const items = await voteService.myVotes(session.userId);
    return ok(items);
  } catch (error) {
    return toErrorResponse(error, 'votes:me');
  }
}
