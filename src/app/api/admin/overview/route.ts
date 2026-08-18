/**
 * GET /api/admin/overview —— 概览指标（P2 后台）。
 *
 * 鉴权：首行 `requireAdmin()`；未登录 401 NOT_LOGGED_IN、非 ADMIN 403 FORBIDDEN。
 */

import type { NextRequest } from 'next/server';

import * as adminService from '@/lib/admin-service';
import { requireAdmin } from '@/lib/auth';
import { ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  try {
    await requireAdmin();
    const data = await adminService.overview();
    return ok(data);
  } catch (error) {
    return toErrorResponse(error, 'admin:overview');
  }
}
