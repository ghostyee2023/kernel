/**
 * POST /api/admin/projects/batch —— 批量操作（P2 后台**唯一写操作端点**）。
 *
 * 入参：`{ operation: 'block'|'unblock'|'purge'|'renew'|'visibility'|'pin'|'unpin', ids: string[], payload? }`。
 *       ids 用 Project.id（cuid），1..100 条；单行操作 = `ids:[id]`。
 *
 * 行为：逐条 try/catch，单条失败落入 `results[i]` 不中断整单（整单仍 200）；
 *       每个 id 成功即 `writeAudit(admin.project.{op}, meta: {slug, title, before, after})`。
 *
 * 鉴权：首行 `requireAdmin()`。
 */

import type { NextRequest } from 'next/server';

import * as adminService from '@/lib/admin-service';
import { requireAdmin } from '@/lib/auth';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import type { AdminBatchInput } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();

    let body: AdminBatchInput;
    try {
      body = (await request.json()) as AdminBatchInput;
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    const result = await adminService.batchOps(body, { userId: session.userId });
    return ok(result);
  } catch (error) {
    return toErrorResponse(error, 'admin:batch');
  }
}
