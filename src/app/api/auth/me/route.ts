/**
 * GET /api/auth/me —— 当前登录用户。
 *
 * 未登录返回 `{ ok: true, data: { user: null } }`（200，不抛 401），
 * 方便前端一次性判断登录态。
 */

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return ok({ user: null });
    }

    const row = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, username: true, nickname: true, role: true },
    });
    if (!row) {
      // 用户已被删除但 Cookie 仍在 → 视为未登录
      return ok({ user: null });
    }

    return ok({
      user: {
        id: row.id,
        username: row.username ?? '',
        nickname: row.nickname,
        role: row.role,
      },
    });
  } catch (error) {
    return toErrorResponse(error, 'auth:me');
  }
}
