/**
 * POST /api/admin/users/[id]/ban —— 封禁 / 解封用户（P2 后台）。
 *
 * 入参：`{ action: 'ban' | 'unban' }`。
 * Q6 边界：禁止对 ADMIN/SUPER_ADMIN 执行 ban；禁止对自己执行 ban（均抛 FORBIDDEN）。
 *
 * 鉴权：首行 `requireAdmin()`。
 */

import type { NextRequest } from 'next/server';

import * as adminService from '@/lib/admin-service';
import { requireAdmin } from '@/lib/auth';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;

    let body: { action?: unknown };
    try {
      body = (await request.json()) as { action?: unknown };
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    if (body.action !== 'ban' && body.action !== 'unban') {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '操作类型不合法');
    }

    const result = await adminService.setUserBan(id, body.action, { userId: session.userId });
    return ok(result);
  } catch (error) {
    return toErrorResponse(error, 'admin:ban');
  }
}
