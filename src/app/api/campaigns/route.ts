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
import { createTtlCache } from '@/lib/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 活动列表缓存：30s TTL，按 status/page/pageSize 分 key。 */
const CAMPAIGNS_CACHE_TTL_MS = 30_000;
const campaignsCache = createTtlCache<Awaited<ReturnType<typeof campaignService.list>>>({
  ttlMs: CAMPAIGNS_CACHE_TTL_MS,
});

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? undefined;
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? DEFAULT_PAGE_SIZE);
    const cacheKey = `list:${status ?? 'all'}:${page}:${pageSize}`;
    const result = await campaignsCache.getOrCompute(cacheKey, () =>
      campaignService.list({ status, page, pageSize }),
    );
    return ok(result.items, { page: result.page, pageSize: result.pageSize, total: result.total });
  } catch (error) {
    return toErrorResponse(error, 'campaigns:list');
  }
}
