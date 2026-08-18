/**
 * POST /api/admin/campaigns —— 创建活动（ADMIN）。
 *
 * body: `{ title, description?, coverUrl?, slug?, collectEndAt?, voteStartAt?,
 *         voteEndAt?, maxVotesPerUser?, allowSelfVote?, voteWeight? }`
 *        → 初始 status='draft'、authorId=session.userId；slug 留空自动生成。
 * 返回 `CampaignDTO`；写 AuditLog（admin.campaign.create）。
 */

import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import * as campaignService from '@/lib/campaign-service';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import type { CampaignInput } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();

    let body: CampaignInput;
    try {
      body = (await request.json()) as CampaignInput;
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    const result = await campaignService.create(body, session.userId);
    return ok(result);
  } catch (error) {
    return toErrorResponse(error, 'admin:campaigns:create');
  }
}
