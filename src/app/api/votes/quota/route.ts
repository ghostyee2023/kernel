/**
 * GET /api/votes/quota?campaign={slug} —— 活动剩余票数（需登录）。
 *
 * 入参：`campaign` = 活动 **slug**（与广场/榜单参数一致）。
 * 返回：`{ campaignId, slug, maxVotesPerUser, used, remaining }`。
 * 错误码：401 NOT_LOGGED_IN / 400 VALIDATION_FAILED（缺参数）/ 404 CAMP_NOT_FOUND。
 */

import type { NextRequest } from 'next/server';

import { requireUser } from '@/lib/auth';
import * as campaignService from '@/lib/campaign-service';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await requireUser();
    const url = new URL(request.url);
    const slug = url.searchParams.get('campaign') ?? '';

    if (slug === '') {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '缺少 campaign 参数');
    }

    const result = await campaignService.quota(slug, session.userId);
    return ok(result);
  } catch (error) {
    return toErrorResponse(error, 'votes:quota');
  }
}
