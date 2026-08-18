/**
 * DELETE /api/votes/[projectId] —— 取消自己投的票（幂等）。
 *
 * 需登录：未登录返回 401 NOT_LOGGED_IN。
 */

import type { NextRequest } from 'next/server';

import { requireUser } from '@/lib/auth';
import { ok, toErrorResponse } from '@/lib/response';
import { invalidateTag } from '@/lib/data-cache';
import * as voteService from '@/lib/vote-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Next 15 起动态参数为 Promise。 */
type Context = { params: Promise<{ projectId: string }> };

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const session = await requireUser();
    const { projectId } = await context.params;
    const result = await voteService.unvote(projectId, session.userId);
    // P2：取消投票同样改变票数 → 失效榜单缓存
    await invalidateTag('rank');
    return ok(result);
  } catch (error) {
    return toErrorResponse(error, 'votes:delete');
  }
}
