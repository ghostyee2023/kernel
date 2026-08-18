/**
 * POST /api/campaigns/[slug]/join —— 报名（幂等，需登录）。
 *
 * body: `{ projectId }`（必须是本人作品，且活动处于 collecting 时间窗内）。
 *
 * 返回：`{ joined:true, alreadyJoined:boolean, projectCount }`。
 * 错误码：401 NOT_LOGGED_IN / 404 CAMP_NOT_FOUND / 409 CAMP_NOT_OPEN /
 *         404 NOT_FOUND（作品不存在或不可见）/ 403 FORBIDDEN（非本人作品）/
 *         409 CAMP_ALREADY_JOINED（removed/rejected 后重复报名）。
 */

import type { NextRequest } from 'next/server';

import { requireUser } from '@/lib/auth';
import * as campaignService from '@/lib/campaign-service';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Next 15 起动态参数为 Promise。 */
type Context = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireUser();
    const { slug } = await context.params;

    let body: { projectId?: unknown };
    try {
      body = (await request.json()) as { projectId?: unknown };
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    const projectId = typeof body.projectId === 'string' ? body.projectId : '';
    const result = await campaignService.join(slug, projectId, session.userId);
    return ok(result);
  } catch (error) {
    return toErrorResponse(error, 'campaigns:join');
  }
}
