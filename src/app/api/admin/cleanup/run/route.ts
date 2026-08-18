/**
 * POST /api/admin/cleanup/run
 *
 * 手动触发一轮完整的生命周期清理（P2 后台改造）。
 *
 * 鉴权（Q4 已拍板）：「ADMIN 会话 或 管理员 token 任一通过」——
 *   - 后台 UI 走会话（`getSession()` + `isAdminRole()`）；
 *   - 运维脚本继续走 `Authorization: Bearer {ADMIN_CLEANUP_TOKEN}` 或 `X-Admin-Token` 头；
 *   - `NODE_ENV=production` 仍直接 403（生产移除 token 只留真实后台鉴权 ⬆️）。
 *
 * 新增：成功后写 `writeAudit(admin.cleanup.run, meta: {batchId, totals})`。
 *
 * 可选请求体：
 *   { "at": "2026-01-01T00:00:00Z" }   注入「现在」，用于演示过期归档
 */

import type { NextRequest } from 'next/server';

import { getSession, isAdminRole } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { ADMIN_TOKEN, AUDIT_ACTION } from '@/lib/constants';
import { runAll } from '@/lib/lifecycle';
import { prisma } from '@/lib/prisma';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 请求体。 */
interface RunBody {
  at?: unknown;
}

/**
 * 常量时间字符串比较，避免 token 被计时侧信道逐字节猜出。
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 校验管理员 token。
 *
 * @throws AppError FORBIDDEN
 */
function assertAdminToken(request: NextRequest): void {
  const bearer = request.headers.get('authorization') ?? '';
  const headerToken = request.headers.get('x-admin-token') ?? '';
  const provided = bearer.toLowerCase().startsWith('bearer ')
    ? bearer.slice('bearer '.length).trim()
    : headerToken.trim();

  if (provided === '' || !safeEqual(provided, ADMIN_TOKEN)) {
    console.warn('[admin][cleanup] token 校验失败');
    throw new AppError(ERROR_CODE.FORBIDDEN, '管理员令牌无效');
  }
}

/**
 * 解析 token 触发场景的审计 actor。
 *
 * AuditLog.actorId 是 User 外键，token 无会话用户，回落为 seed 的管理员账号；
 * 管理员不存在时（审计写入会因外键失败）仅告警，不影响主流程。
 */
async function resolveTokenActorId(): Promise<string> {
  const admin = await prisma.user.findFirst({
    where: { username: 'admin' },
    select: { id: true },
  });
  return admin?.id ?? 'admin-token';
}

export async function POST(request: NextRequest) {
  try {
    // Q4：生产环境一律拒绝手动触发
    if (process.env.NODE_ENV === 'production') {
      throw new AppError(ERROR_CODE.FORBIDDEN, '生产环境不允许手动触发清理');
    }

    // Q4：ADMIN 会话 或 管理员 token 任一通过
    let actorId: string;
    const session = await getSession().catch(() => null);
    if (session && isAdminRole(session.role)) {
      actorId = session.userId;
    } else {
      assertAdminToken(request);
      actorId = await resolveTokenActorId();
    }

    let body: RunBody = {};
    try {
      const text = await request.text();
      body = text.trim() === '' ? {} : (JSON.parse(text) as RunBody);
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    let at = new Date();
    if (typeof body.at === 'string' && body.at.trim() !== '') {
      const parsed = new Date(body.at);
      if (Number.isNaN(parsed.getTime())) {
        throw new AppError(ERROR_CODE.VALIDATION_FAILED, 'at 不是合法的 ISO 时间');
      }
      at = parsed;
    }

    const result = await runAll(at);

    await writeAudit({
      actorId,
      action: AUDIT_ACTION.CLEANUP_RUN,
      targetType: 'cleanup',
      targetId: result.batchId,
      detail: `手动触发清理 batch=${result.batchId}，影响 ${result.totals.affected} 条，释放 ${result.totals.freedBytes} 字节`,
      meta: {
        batchId: result.batchId,
        totals: result.totals,
        reports: result.reports.map((report) => ({
          action: report.action,
          scanned: report.scanned,
          affected: report.affected,
          failures: report.failures,
          freedBytes: report.freedBytes,
        })),
      },
    });

    return ok(result);
  } catch (error) {
    return toErrorResponse(error, 'admin:cleanup');
  }
}
