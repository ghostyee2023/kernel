/**
 * POST /api/auth/login —— 用户名密码登录（展示用 + P3.5 密码兼容）。
 *
 * 规则（已拍板，对齐原型语义 + P3.5 §1.6 / §7.3）：
 *   - `admin` / `123456` → 管理员（role=ADMIN，硬编码分支不设 hash，**不动**）；
 *   - 普通用户三分支：
 *       ① 已封禁（BANNED）→ 403（现状保留）；
 *       ② 存在 + 有 passwordHash → 校验密码：错误 400 `PASSWORD_WRONG`「用户名或密码错误」；
 *          正确 → update（**update 绝不写 passwordHash，防止覆盖已设密码**）；
 *       ③ 不存在 / 存在但无 hash → upsert（create 不写 passwordHash）→ 任意非空密码可登录（旧数据兼容）。
 */

import type { NextRequest } from 'next/server';

import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS, verifyPassword } from '@/lib/auth';
import { ROLE, USER_STATUS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 登录入参。 */
interface LoginBody {
  username?: unknown;
  password?: unknown;
}

/** 对外用户信息。 */
export interface AuthUser {
  id: string;
  username: string;
  nickname: string;
  role: string;
}

/** 按用户名 upsert 用户并返回对外信息（P3.5 三分支，见文件头注释）。 */
async function upsertUserByUsername(username: string, password: string, isAdmin: boolean): Promise<AuthUser> {
  if (isAdmin) {
    const row = await prisma.user.upsert({
      where: { username: 'admin' },
      update: { nickname: '管理员', role: ROLE.ADMIN, status: USER_STATUS.ACTIVE },
      create: {
        username: 'admin',
        nickname: '管理员',
        role: ROLE.ADMIN,
        status: USER_STATUS.ACTIVE,
      },
      select: { id: true, username: true, nickname: true, role: true },
    });
    return { id: row.id, username: row.username ?? '', nickname: row.nickname, role: row.role };
  }

  // 普通用户：nickname=username、role=USER（展示用自动注册）。
  // 已封禁账号拒绝登录（P2 Q6 封禁生效：登录时回查 DB status）。
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing && existing.status === USER_STATUS.BANNED) {
    throw new AppError(ERROR_CODE.FORBIDDEN, '该账号已被封禁，请联系管理员');
  }

  // ② 存在 + 有 hash → 校验密码（错误 400 PASSWORD_WRONG）；update 不写 passwordHash
  if (existing && existing.passwordHash) {
    if (!verifyPassword(password, existing.passwordHash)) {
      throw new AppError(ERROR_CODE.PASSWORD_WRONG, '用户名或密码错误');
    }
    const row = await prisma.user.update({
      where: { username },
      data: { nickname: username, role: ROLE.USER, status: USER_STATUS.ACTIVE },
      select: { id: true, username: true, nickname: true, role: true },
    });
    return { id: row.id, username: row.username ?? '', nickname: row.nickname, role: row.role };
  }

  // ③ 不存在 / 无 hash → upsert（create/update 均不写 passwordHash，任意非空密码可登录）
  const row = await prisma.user.upsert({
    where: { username },
    update: { nickname: username, role: ROLE.USER, status: USER_STATUS.ACTIVE },
    create: { username, nickname: username, role: ROLE.USER, status: USER_STATUS.ACTIVE },
    select: { id: true, username: true, nickname: true, role: true },
  });
  return { id: row.id, username: row.username ?? '', nickname: row.nickname, role: row.role };
}

export async function POST(request: NextRequest) {
  try {
    let body: LoginBody;
    try {
      body = (await request.json()) as LoginBody;
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (username === '' || password === '') {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请输入用户名和密码');
    }
    if (username.length > 64) {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '用户名过长');
    }

    const isAdmin = username === 'admin';
    if (isAdmin && password !== '123456') {
      // 对齐原型 auth-err 语义
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '用户名或密码错误');
    }

    const user = await upsertUserByUsername(username, password, isAdmin);
    const token = createSessionToken({ id: user.id, username: user.username, role: user.role });

    const res = ok({ user }, undefined, 200);
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
      // 本地 http 桩不开 secure；生产 HTTPS 部署时必须开启 ⬆️
      secure: false,
    });

    console.log(`[auth][login] userId=${user.id} username=${user.username} role=${user.role}`);
    return res;
  } catch (error) {
    return toErrorResponse(error, 'auth:login');
  }
}
