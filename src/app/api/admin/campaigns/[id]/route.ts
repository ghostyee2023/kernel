/**
 * PATCH /api/admin/campaigns/[id] —— 更新活动规则 / 推进状态（ADMIN）。
 *
 * body: create 的全部规则字段（可选）+ `status?`（draft/collecting/voting/ended）。
 * 时间顺序校验（collectEndAt <= voteStartAt(可空) <= voteEndAt）由 service 统一执行。
 * 返回 `CampaignDTO`；写 AuditLog（admin.campaign.update，meta 含 before/after）。
 */

import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import * as campaignService from '@/lib/campaign-service';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import type { CampaignInput } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Next 15 起动态参数为 Promise。 */
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;

    let body: CampaignInput;
    try {
      body = (await request.json()) as CampaignInput;
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    const result = await campaignService.patch(id, body, session.userId);
    return ok(result);
  } catch (error) {
    return toErrorResponse(error, 'admin:campaigns:update');
  }
}
