/**
 * PATCH /api/auth/profile —— 更新个人资料（P3 补：昵称 / 头像）。
 *
 * 契约：
 *   ① requireUser()：未登录 401 NOT_LOGGED_IN
 *   ② nickname：1..30 字符（去首尾空白后必填）
 *   ③ avatarUrl：可空；非空时必须是 http(s) URL（≤ 500 字符）
 *   ④ 更新 nickname / avatarUrl → 200 { ok, data:{ nickname, avatarUrl } }
 */

import type { NextRequest } from 'next/server';

import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 个人资料入参。 */
interface ProfileBody {
  nickname?: unknown;
  avatarUrl?: unknown;
}

/** 昵称最大长度。 */
const NICKNAME_MAX_LEN = 30;
/** 头像 URL 最大长度。 */
const AVATAR_URL_MAX_LEN = 500;

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireUser();

    let body: ProfileBody;
    try {
      body = (await request.json()) as ProfileBody;
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    // 昵称：必填、去空白、1..30
    const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
    if (nickname === '' || nickname.length > NICKNAME_MAX_LEN) {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, `昵称需为 1-${NICKNAME_MAX_LEN} 个字符`);
    }

    // 头像：可空；非空必须是 http(s) URL
    let avatarUrl: string | null = null;
    if (body.avatarUrl !== undefined && body.avatarUrl !== null) {
      const raw = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : '';
      if (raw !== '') {
        if (raw.length > AVATAR_URL_MAX_LEN) {
          throw new AppError(ERROR_CODE.VALIDATION_FAILED, '头像 URL 过长');
        }
        let parsed: URL;
        try {
          parsed = new URL(raw);
        } catch {
          throw new AppError(ERROR_CODE.VALIDATION_FAILED, '头像 URL 格式不正确');
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new AppError(ERROR_CODE.VALIDATION_FAILED, '头像 URL 仅支持 http/https');
        }
        avatarUrl = raw;
      }
    }

    const updated = await prisma.user.update({
      where: { id: session.userId },
      data: { nickname, avatarUrl },
      select: { nickname: true, avatarUrl: true },
    });

    console.log(`[auth][profile] userId=${session.userId} nickname=${updated.nickname}`);
    return ok({ nickname: updated.nickname, avatarUrl: updated.avatarUrl });
  } catch (error) {
    return toErrorResponse(error, 'auth:profile');
  }
}
