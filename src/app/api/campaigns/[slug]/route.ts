/**
 * GET /api/campaigns/[slug] —— 活动详情（公开）。
 *
 * 返回 `CampaignDetailDTO`（规则 + 时间线 + projects：joined 作品按活动内票数 desc、
 * joinedAt asc）。draft / 不存在统一 404 CAMP_NOT_FOUND，不泄漏存在性。
 */

import type { NextRequest } from 'next/server';

import * as campaignService from '@/lib/campaign-service';
import { ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Next 15 起动态参数为 Promise。 */
type Context = { params: Promise<{ slug: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const data = await campaignService.getBySlug(slug);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error, 'campaigns:detail');
  }
}
