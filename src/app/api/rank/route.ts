/**
 * GET /api/rank —— 排行榜（公开，轻量）。
 *
 * 入参：
 *   - `scope=global`（缺省）：现有全站票数总榜 `ProjectDTO[]`（ProjectStats.voteCount，
 *     含活动票）；
 *   - `scope=campaign&campaign={slug}`：活动内排名 `CampaignRankItemDTO[]`
 *     （活动内票数 desc、joinedAt asc）。
 *   - `limit`：默认 12/上限 48。
 *
 * 错误码：400 VALIDATION_FAILED（scope=campaign 缺 campaign）/ 404 CAMP_NOT_FOUND。
 */

import type { NextRequest } from 'next/server';

import * as campaignService from '@/lib/campaign-service';
import * as projectService from '@/lib/project-service';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import { createTtlCache } from '@/lib/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 排行榜缓存：30s TTL。global/campaign 两类分支返回类型不同，用 unknown 兜底。 */
const RANK_CACHE_TTL_MS = 30_000;
const rankCache = createTtlCache<unknown>({ ttlMs: RANK_CACHE_TTL_MS });

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope') ?? 'global';
    const limit = Number(url.searchParams.get('limit') ?? 12);

    // 校验在缓存之前：错误不应被缓存
    if (scope === 'campaign') {
      const slug = url.searchParams.get('campaign') ?? '';
      if (slug === '') {
        throw new AppError(ERROR_CODE.VALIDATION_FAILED, 'scope=campaign 时必须提供 campaign 参数');
      }
      const cacheKey = `campaign:${slug}:${limit}`;
      const items = await rankCache.getOrCompute(cacheKey, () => campaignService.rank(slug, limit));
      return ok(items);
    }

    const cacheKey = `global:${limit}`;
    const items = await rankCache.getOrCompute(cacheKey, () => projectService.rank(limit));
    return ok(items);
  } catch (error) {
    return toErrorResponse(error, 'rank');
  }
}
