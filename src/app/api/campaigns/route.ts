/**
 * GET /api/campaigns —— 活动列表（公开）。
 *
 * 入参：`status`（单值过滤，按存储状态）、`page`、`pageSize`（默认 12/上限 48）。
 * 返回：`{ items: CampaignCardDTO[], meta:{page,pageSize,total} }`。
 * `status` 字段为懒计算 effective（collecting 到点自动显示 voting / ended）。
 * draft 一律不出现（不泄漏存在性）。
 */

import type { NextRequest } from 'next/server';

import * as campaignService from '@/lib/campaign-service';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? undefined;
    const result = await campaignService.list({
      status,
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? DEFAULT_PAGE_SIZE),
    });
    return ok(result.items, { page: result.page, pageSize: result.pageSize, total: result.total });
  } catch (error) {
    return toErrorResponse(error, 'campaigns:list');
  }
}
