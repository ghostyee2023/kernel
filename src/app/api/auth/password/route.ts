/**
 * POST /api/auth/password —— 修改密码（P3.5，⭐ 新端点）。
 *
 * 契约（docs/P3-我的后台设计.md §1.7；2026-08-18 更新：admin 走 DB hash 校验，允许改密码）：
 *   ① requireUser()：未登录 401 NOT_LOGGED_IN
 *   ② newPassword 长度 < MIN_PASSWORD_LEN(6) → 400 PASSWORD_WEAK
 *   ③ 有 passwordHash 且 currentPassword 不匹配 → 400 OLD_PASSWORD_WRONG
 *   ④ 无 hash → 跳过当前密码校验（可空/任意，Q3 兼容旧用户）
 *   行为：写 passwordHash（scrypt，node:crypto 零新依赖）→ 200 { ok, data:{ changed:true } }
 *         → writeAudit(auth.user.password-changed)（失败不阻断主流程）
 *   会话：**不强制重新登录**（Cookie 不失效，Q3 拍板）。
 */

import type { NextRequest } from 'next/server';

import { hashPassword, requireUser, verifyPassword } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { AUDIT_ACTION, MIN_PASSWORD_LEN } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 修改密码入参（确认字段仅前端校验，后端不收）。 */
interface PasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireUser();

    let body: PasswordBody;
    try {
      body = (await request.json()) as PasswordBody;
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    // ① 新密码长度校验（后端兜底，前端已双重校验）
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (newPassword.length < MIN_PASSWORD_LEN) {
      throw new AppError(ERROR_CODE.PASSWORD_WEAK);
    }

    // ② 有 hash 时校验当前密码；无 hash（旧用户/任意登录）跳过
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true },
    });
    if (!user) {
      throw new AppError(ERROR_CODE.NOT_FOUND);
    }
    if (user.passwordHash) {
      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      if (!verifyPassword(currentPassword, user.passwordHash)) {
        throw new AppError(ERROR_CODE.OLD_PASSWORD_WRONG);
      }
    }

    // ④ 写 passwordHash（绝不覆盖其它字段）
    await prisma.user.update({
      where: { id: session.userId },
      data: { passwordHash: hashPassword(newPassword) },
    });

    // ⑤ 审计（增强能力，写失败不阻断）
    await writeAudit({
      actorId: session.userId,
      action: AUDIT_ACTION.PASSWORD_CHANGED,
      targetType: 'user',
      targetId: session.userId,
      detail: '用户修改密码',
    });

    console.log(`[auth][password] userId=${session.userId} changed=true`);
    return ok({ changed: true });
  } catch (error) {
    return toErrorResponse(error, 'auth:password');
  }
}
