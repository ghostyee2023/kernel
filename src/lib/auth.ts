/**
 * 会话（用户名密码展示版）—— httpOnly 签名 Cookie。
 *
 * P1 第一阶段为「展示用登录」：不对密码做任何存储与校验，登录成功即签发
 * 一个由 `AUTH_SECRET` 做 HMAC-SHA256 签名的 Cookie，防止被客户端伪造。
 *
 * ⬆️ 生产化替换点：本模块整体替换为 Auth.js + 微信 Provider（docs/02 §5.4）。
 *    届时保留 `getSession() / requireUser()` 的签名不变，调用方零改动。
 *
 * 铁律：
 *   1. Cookie 一律 `httpOnly`，前端 JS 不可读。
 *   2. 签名用 node:crypto（黑名单零引入：不装 jose / jsonwebtoken / next-auth）。
 *   3. `getSession()` 必须 `await`（Next 15 的 cookies() 为异步）。
 *   4. 本模块只允许被服务端代码（Route Handler / Server Component）引用，
 *      禁止从 'use client' 组件导入。
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

import { ROLE } from './constants';
import { AppError, ERROR_CODE } from './response';

/** 会话 Cookie 名。 */
export const SESSION_COOKIE = 'kernel_session';

/** 会话有效期：7 天。 */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

/**
 * 签名密钥。
 *
 * ⚠️ 警告：`AUTH_SECRET` 缺失时回落固定 dev fallback —— 仅供本地演示，
 * 任何部署环境都必须显式设置 `AUTH_SECRET`，否则会话可被伪造。
 */
const AUTH_SECRET: string =
  process.env.AUTH_SECRET !== undefined && process.env.AUTH_SECRET !== ''
    ? process.env.AUTH_SECRET
    : 'kernel-dev-fallback-secret-do-not-use-in-prod';

/** 会话载荷（不含签名）。 */
export interface SessionPayload {
  userId: string;
  username: string;
  role: string;
  /** 过期时间（epoch 毫秒）。 */
  exp: number;
}

/** 对外暴露的会话用户信息（无敏感字段）。 */
export interface SessionUser {
  id: string;
  username: string;
  role: string;
}

/** 对 payload 原文做 HMAC-SHA256 签名（base64url）。 */
function sign(encoded: string): string {
  return createHmac('sha256', AUTH_SECRET).update(encoded).digest('base64url');
}

/** 常数时间比较，防时序攻击。 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/* ============================================================================
   P3.5 密码派生（node:crypto scrypt，零新依赖）
   存储格式：`scrypt$N$r$p$saltHex$hashHex`（N=16384 / r=8 / p=1 / keyLen=64 / salt=16B）
   铁律：本实现只允许被服务端代码引用（node:crypto 不进客户端 bundle）。
   ========================================================================== */

/** scrypt 迭代档位（Node scryptSync 默认档，本地桩兼顾安全与延迟）。 */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
/** 派生密钥长度（字节）。 */
const SCRYPT_KEYLEN = 64;
/** 盐长度（字节）。 */
const SCRYPT_SALT_BYTES = 16;
/** 存储格式前缀。 */
const SCRYPT_PREFIX = 'scrypt';

/**
 * 派生并格式化密码哈希。
 *
 * @param password 明文密码。
 * @returns `scrypt$N$r$p$saltHex$hashHex` 字符串，可直接落库。
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `${SCRYPT_PREFIX}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * 校验明文密码与存储的哈希是否匹配（常数时间比较）。
 *
 * @param password 明文密码。
 * @param stored `hashPassword` 产出的存储串；格式非法返回 false。
 * @returns 匹配返回 true；存储串非法 / 参数不合法一律 false（不抛错，调用方按业务语义处理）。
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = scryptSync(password, salt, expected.length, { N, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * 生成会话 token：`base64url(payload).base64url(signature)`。
 *
 * @param user 用户信息（id / username / role）。
 */
export function createSessionToken(user: { id: string; username: string; role: string }): string {
  const payload: SessionPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

/**
 * 校验并解析会话 token。
 *
 * @param token Cookie 里的原始值。
 * @returns 有效会话载荷；签名非法 / 格式错误 / 已过期一律返回 null。
 */
export function verifySessionToken(token: string): SessionPayload | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (signature === '' || !safeEqual(signature, sign(encoded))) return null;

  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const payload = JSON.parse(raw) as Partial<SessionPayload>;
    if (typeof payload.userId !== 'string' || payload.userId === '') return null;
    if (typeof payload.username !== 'string') return null;
    if (typeof payload.role !== 'string') return null;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
    if (payload.exp < Date.now()) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * 读取当前请求的会话（服务端）。
 *
 * @returns 会话载荷；未登录 / token 非法 / 已过期返回 null。
 */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** 把会话载荷裁剪成对外安全的用户信息。 */
export function toSessionUser(payload: SessionPayload): SessionUser {
  return { id: payload.userId, username: payload.username, role: payload.role };
}

/**
 * 清空会话 Cookie（登出）。
 */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * 强制要求登录。
 *
 * @throws AppError NOT_LOGGED_IN（401）未登录 / 会话失效时。
 */
export async function requireUser(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new AppError(ERROR_CODE.NOT_LOGGED_IN);
  return session;
}

/**
 * 判断角色是否具备管理员权限。
 *
 * `ADMIN` 与 `SUPER_ADMIN` 都视为管理员（后者是前者的超集）。
 */
export function isAdminRole(role: string | undefined | null): boolean {
  return role === ROLE.ADMIN || role === ROLE.SUPER_ADMIN;
}

/**
 * 强制要求管理员会话。
 *
 * 在 `requireUser()` 之上叠加角色校验：未登录抛 NOT_LOGGED_IN（401）；
 * 已登录但非 ADMIN/SUPER_ADMIN 抛 FORBIDDEN（403）。
 *
 * 与 `canManageProject` 一致，纯 cookie 角色判定，不引 prisma。
 *
 * ⬆️ 生产化加固点：cookie 中 role 可能滞后于 DB 变更，生产环境应在
 *    `requireAdmin()` 内回查 DB（role + status=ACTIVE）再放行。
 *
 * @throws AppError NOT_LOGGED_IN / FORBIDDEN
 */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireUser();
  if (!isAdminRole(session.role)) throw new AppError(ERROR_CODE.FORBIDDEN, '需要管理员权限');
  return session;
}

/**
 * 判断会话用户能否管理某件作品：作者本人或管理员。
 *
 * 供 PATCH / DELETE / renew 等「作者或管理员」接口的 route 层复用。
 *
 * @param session 当前会话；未登录传 null。
 * @param project 至少携带 `authorId` 的作品信息（`ProjectDTO` / `peek` 返回值）。
 */
export function canManageProject(session: SessionPayload | null, project: { authorId: string }): boolean {
  if (!session) return false;
  return project.authorId === session.userId || isAdminRole(session.role);
}
