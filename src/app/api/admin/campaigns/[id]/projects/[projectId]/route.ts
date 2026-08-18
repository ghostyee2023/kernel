/**
 * DELETE /api/admin/campaigns/[id]/projects/[projectId] —— 移除/拒绝报名（ADMIN，幂等）。
 *
 * 只阻止新投票（vote 校验链 ③ 失败）；存量票保留、仍计入活动累计（§八 Q8）。
 * 返回 `{ removed:true }`；写 AuditLog（admin.campaign.remove-project）。
 */

import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import * as campaignService from '@/lib/campaign-service';
import { ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Next 15 起动态参数为 Promise。 */
type Context = { params: Promise<{ id: string; projectId: string }> };

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const session = await requireAdmin();
    const { id, projectId } = await context.params;
    const result = await campaignService.removeProject(id, projectId, session.userId);
    return ok(result);
  } catch (error) {
    return toErrorResponse(error, 'admin:campaigns:remove-project');
  }
}
