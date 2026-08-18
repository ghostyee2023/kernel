/**
 * GET /api/admin/votes/audit —— 风控审计聚合（按 ip / device / user 分组）。
 *
 * 入参：`group`（缺省 ip）、`campaignId?`、`suspiciousOnly`（'1' | 'true'）、
 *       `page`、`pageSize`（默认 20 / 上限 100）。
 * 鉴权：首行 `requireAdmin()`。
 */

import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { ADMIN_DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import * as riskService from '@/lib/risk-service';
import type { RiskAuditQuery } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 解析查询参数（group 非法交给 service 校验）。 */
function parseQuery(url: URL): RiskAuditQuery {
  const group = url.searchParams.get('group') ?? 'ip';
  if (group !== 'ip' && group !== 'device' && group !== 'user') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '分组维度取值不合法');
  }
  const suspicious = url.searchParams.get('suspiciousOnly');
  return {
    group,
    campaignId: url.searchParams.get('campaignId') ?? undefined,
    suspiciousOnly: suspicious === '1' || suspicious === 'true',
    page: Number(url.searchParams.get('page') ?? 1),
    pageSize: Number(url.searchParams.get('pageSize') ?? ADMIN_DEFAULT_PAGE_SIZE),
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const result = await riskService.auditGroups(parseQuery(new URL(request.url)));
    return ok(result.items, { page: result.page, pageSize: result.pageSize, total: result.total });
  } catch (error) {
    return toErrorResponse(error, 'admin:votes-audit');
  }
}
