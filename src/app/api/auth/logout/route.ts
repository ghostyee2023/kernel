/**
 * POST /api/auth/logout —— 退出登录（清空会话 Cookie）。
 */

import { destroySession } from '@/lib/auth';
import { ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await destroySession();
    return ok({ loggedOut: true });
  } catch (error) {
    return toErrorResponse(error, 'auth:logout');
  }
}
