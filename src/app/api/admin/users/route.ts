/**
 * GET /api/admin/users —— 用户列表（筛选 + 分页，含 projectCount）。
 *
 * 入参：`q`（username/nickname 模糊）、`role`、`status`、`page`、`pageSize`。
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
function parseQuery(url: URL): adminService.AdminUserListQuery {
  return {
    q: url.searchParams.get('q') ?? undefined,
    role: url.searchParams.get('role') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    page: Number(url.searchParams.get('page') ?? 1),
    pageSize: Number(url.searchParams.get('pageSize') ?? ADMIN_DEFAULT_PAGE_SIZE),
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const result = await adminService.listUsers(parseQuery(new URL(request.url)));
    return ok(result.items, { page: result.page, pageSize: result.pageSize, total: result.total });
  } catch (error) {
    return toErrorResponse(error, 'admin:users');
  }
}
