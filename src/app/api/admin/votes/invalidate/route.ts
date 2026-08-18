/**
 * POST /api/admin/votes/invalidate —— 批量作废 + 榜单重算。
 *
 * body: `{ voteIds?: string[], scope?: { type: 'ip'|'device', value }, campaignId?, reason }`
 *   - `voteIds` 与 `scope` **二选一**（都缺/都有 → 400 VALIDATION_FAILED）；
 *   - `reason` 必填、≤ 200 字；
 *   - 幂等：已作废 / 不存在的票自动跳过；空集返回 `invalidated:0`（200）。
 *
 * 事务：作废 → 受影响作品 voteCount 全量重算（COUNT(valid=true)）→ voteInvalid 累加
 * → writeAudit(admin.votes.invalidate, targetId=batch:{uuid})。
 * 鉴权：首行 `requireAdmin()`。
 */

import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import * as riskService from '@/lib/risk-service';
import type { InvalidateInput } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    const input: InvalidateInput = {
      voteIds: Array.isArray(body.voteIds) ? (body.voteIds as string[]) : undefined,
      scope:
        body.scope != null && typeof body.scope === 'object'
          ? (body.scope as { type: 'ip' | 'device'; value: string })
          : undefined,
      campaignId: typeof body.campaignId === 'string' ? body.campaignId : undefined,
      reason: typeof body.reason === 'string' ? body.reason : '',
    };

    const result = await riskService.invalidate(input, { userId: session.userId });
    return ok(result);
  } catch (error) {
    return toErrorResponse(error, 'admin:votes-invalidate');
  }
}
