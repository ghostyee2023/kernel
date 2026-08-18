/**
 * POST /api/votes —— 投票（幂等）。
 *
 * body: `{ projectId, campaignId?, deviceHash?, dwellMs? }`
 * 需登录：未登录返回 401 NOT_LOGGED_IN。
 *
 * P1 活动模块扩展：带 `campaignId`（活动 DB id）时走活动校验链
 * （活动在投票期 + 作品已报名 + 自投开关 + 每人限票），返回
 * `VoteResult + campaignVoteCount + remainingQuota`；
 * **不带 campaignId 行为与既有全站赞完全一致**。
 *
 * P2 风控扩展：body 增加可选的 `deviceHash` / `dwellMs`（前端指纹采集），
 * 服务端从请求头解析客户端 IP（x-forwarded-for 首值 → x-real-ip → 'unknown'），
 * 一并注入 `vote()` 参与风险评分；缺省时行为与现状一致（裸投 riskScore=0）。
 */

import type { NextRequest } from 'next/server';

import { requireUser } from '@/lib/auth';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import { invalidateTag } from '@/lib/data-cache';
import * as voteService from '@/lib/vote-service';
import type { VoteOptions } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 解析客户端 IP（docs/P2-风控模块设计.md §7.6）：
 * `x-forwarded-for` 首值 → `x-real-ip` → `'unknown'`。
 */
function resolveClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first !== '') return first;
  }
  const real = request.headers.get('x-real-ip');
  if (real && real.trim() !== '') return real.trim();
  return 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireUser();

    let body: { projectId?: unknown; campaignId?: unknown; deviceHash?: unknown; dwellMs?: unknown };
    try {
      body = (await request.json()) as {
        projectId?: unknown;
        campaignId?: unknown;
        deviceHash?: unknown;
        dwellMs?: unknown;
      };
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    const projectId = typeof body.projectId === 'string' ? body.projectId : '';
    const campaignId =
      typeof body.campaignId === 'string' && body.campaignId.trim() !== '' ? body.campaignId : undefined;
    const deviceHash =
      typeof body.deviceHash === 'string' && body.deviceHash.trim() !== '' ? body.deviceHash.trim() : undefined;
    const dwellMs = typeof body.dwellMs === 'number' ? body.dwellMs : undefined;

    const options: VoteOptions = { deviceHash, dwellMs, ip: resolveClientIp(request) };
    if (campaignId) options.campaignId = campaignId;

    const result = await voteService.vote(projectId, session.userId, options);
    // P2：投票改变票数 → 失效榜单与活动票数缓存（projects 列表按 new 排序不受影响，容忍弱一致）
    await invalidateTag('rank');
    if (campaignId) await invalidateTag(`campaign:${campaignId}`);
    return ok(result);
  } catch (error) {
    return toErrorResponse(error, 'votes:create');
  }
}
