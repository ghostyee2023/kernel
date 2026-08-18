/**
 * GET /api/admin/votes/audit/detail —— 可疑票明细（按 group+key 过滤）。
 *
 * 入参：`group`（ip/device/user）、`key`（分组键）、`campaignId?`、
 *       `page`、`pageSize`（默认 20 / 上限 100）。
 * 鉴权：首行 `requireAdmin()`。
 */

import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { ADMIN_DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import * as riskService from '@/lib/risk-service';
import type { RiskDetailQuery } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 解析查询参数（group/key 非法交给 service 校验）。 */
function parseQuery(url: URL): RiskDetailQuery {
  const group = url.searchParams.get('group') ?? 'ip';
  if (group !== 'ip' && group !== 'device' && group !== 'user') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '分组维度取值不合法');
  }
  const key = url.searchParams.get('key') ?? '';
  if (key === '') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '缺少 key 参数');
  }
  return {
    group,
    key,
    campaignId: url.searchParams.get('campaignId') ?? undefined,
    page: Number(url.searchParams.get('page') ?? 1),
    pageSize: Number(url.searchParams.get('pageSize') ?? ADMIN_DEFAULT_PAGE_SIZE),
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const result = await riskService.auditDetail(parseQuery(new URL(request.url)));
    return ok(result.items, { page: result.page, pageSize: result.pageSize, total: result.total });
  } catch (error) {
    return toErrorResponse(error, 'admin:votes-audit-detail');
  }
}
