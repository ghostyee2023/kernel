/**
 * GET /api/admin/cleanup/logs —— 清理日志列表（筛选 + 分页，detail 已 parse）。
 *
 * 入参：`action`、`success`（'true' | 'false'）、`page`、`pageSize`。
 * 概览页复用本端点 `pageSize=8` 取最近日志。
 *
 * 鉴权：首行 `requireAdmin()`。
 */

import type { NextRequest } from 'next/server';

import * as adminService from '@/lib/admin-service';
import { requireAdmin } from '@/lib/auth';
import { ADMIN_DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 解析列表参数。 */
function parseQuery(url: URL): adminService.AdminCleanupLogQuery {
  return {
    action: url.searchParams.get('action') ?? undefined,
    success: url.searchParams.get('success') ?? undefined,
    page: Number(url.searchParams.get('page') ?? 1),
    pageSize: Number(url.searchParams.get('pageSize') ?? ADMIN_DEFAULT_PAGE_SIZE),
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const result = await adminService.listCleanupLogs(parseQuery(new URL(request.url)));
    return ok(result.items, { page: result.page, pageSize: result.pageSize, total: result.total });
  } catch (error) {
    return toErrorResponse(error, 'admin:cleanup-logs');
  }
}
