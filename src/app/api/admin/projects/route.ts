/**
 * GET /api/admin/projects —— 全量作品列表（含私密/已归档/已封禁，筛选 + 分页）。
 *
 * 入参：`status`（单值或多值逗号分隔）、`visibility`、`q`（slug/title/authorName 模糊）、
 *       `sort`（createdAt | expireAt | voteCount，缺省 createdAt desc）、`page`、`pageSize`。
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
function parseQuery(url: URL): adminService.AdminProjectListQuery {
  const sortRaw = url.searchParams.get('sort');
  const sort = sortRaw === 'expireAt' || sortRaw === 'voteCount' ? sortRaw : 'createdAt';
  return {
    status: url.searchParams.get('status') ?? undefined,
    visibility: url.searchParams.get('visibility') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    sort,
    page: Number(url.searchParams.get('page') ?? 1),
    pageSize: Number(url.searchParams.get('pageSize') ?? ADMIN_DEFAULT_PAGE_SIZE),
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const result = await adminService.listProjects(parseQuery(new URL(request.url)));
    return ok(result.items, { page: result.page, pageSize: result.pageSize, total: result.total });
  } catch (error) {
    return toErrorResponse(error, 'admin:projects');
  }
}
