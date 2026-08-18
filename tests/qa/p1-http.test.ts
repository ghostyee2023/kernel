/**
 * P1 第一阶段 QA 独立验证 —— 认证 + 投票（HTTP 层）。
 *
 * 运行前提：
 *   1) `npm run db:reset`（seed 3 demo）
 *   2) `node --import tsx tests/qa/p1-fixtures.ts`（建 ARCHIVED / PRIVATE 夹具）
 *   3) `npx next start -p <PORT>`（production build 产物）
 *   4) 本文件以 `node --import tsx --test tests/qa/p1-http.test.ts` 运行
 *
 * 覆盖：docs/03 §3.2 投票 + §3.5 认证（展示用用户名密码版）的全部契约点，
 * 以及统一响应体 {ok,data} / {ok:false,error:{code,message}}。
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';

import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.QA_PORT ?? 3322);
const BASE = `http://127.0.0.1:${PORT}`;

const prisma = new PrismaClient();

/** 极简 cookie jar：保存服务端 Set-Cookie 的 name=value。 */
class CookieJar {
  private map = new Map<string, string>();

  setFromResponse(response: Response): void {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const raw of setCookies) {
      const pair = raw.split(';')[0];
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      // 空值 = 删除
      if (value === '') this.map.delete(name);
      else this.map.set(name, value);
    }
  }

  header(): string {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get(name: string): string | undefined {
    return this.map.get(name);
  }

  clear(): void {
    this.map.clear();
  }
}

async function api(
  path: string,
  init: RequestInit & { jar?: CookieJar } = {},
): Promise<{ status: number; body: any; cookieHeader: string | null; setCookie: string[] }> {
  const { jar, ...rest } = init;
  const headers = new Headers(rest.headers ?? {});
  if (jar) headers.set('cookie', jar.header());
  if (rest.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const response = await fetch(`${BASE}${path}`, { ...rest, headers, redirect: 'manual' });
  let body: unknown;
  const text = await response.text();
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (jar && setCookie.length > 0) jar.setFromResponse(response);
  return {
    status: response.status,
    body,
    cookieHeader: setCookie.length > 0 ? setCookie.join('\n') : null,
    setCookie,
  };
}

/** 登录并返回 jar。 */
async function login(jar: CookieJar, username: string, password: string) {
  return api('/api/auth/login', {
    method: 'POST',
    jar,
    body: JSON.stringify({ username, password }),
  });
}

/** 查询作品 id。 */
async function projectIdBySlug(slug: string): Promise<string> {
  const row = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
  assert.ok(row, `夹具作品 ${slug} 不存在`);
  return row.id;
}

let pubId = '';
let unlistedId = '';
let archId = '';
let privId = '';
let ghostId = '';

before(async () => {
  pubId = await projectIdBySlug('Aur9raFx');
  unlistedId = await projectIdBySlug('PuLse7Kd');
  archId = await projectIdBySlug('QaArch01');
  privId = await projectIdBySlug('QaPriv01');
  ghostId = 'cafebabe0000000000000000'; // 不存在
  // 清掉历史票，保证 count 起点确定
  await prisma.vote.deleteMany({});
  await prisma.projectStats.updateMany({ data: { voteCount: 0 } });
});

after(async () => {
  await prisma.$disconnect();
});

/* ============================================================================
   阶段 B —— 认证
   ========================================================================== */

test('B1 admin/123456 登录 → 200 role=ADMIN + kernel_session HttpOnly', async () => {
  const jar = new CookieJar();
  const res = await login(jar, 'admin', '123456');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.user.username, 'admin');
  assert.equal(res.body.data.user.role, 'ADMIN');
  assert.ok(res.cookieHeader, '应下发 Set-Cookie');
  assert.match(res.cookieHeader!, /kernel_session=/);
  assert.match(res.cookieHeader!, /HttpOnly/i);
  assert.ok(jar.get('kernel_session'), 'cookie jar 应持有 kernel_session');
});

test('B2 任意用户名/密码（zzz/abc）登录 → 200 role=USER（upsert）', async () => {
  const jar = new CookieJar();
  const res = await login(jar, 'zzz', 'abc');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.username, 'zzz');
  assert.equal(res.body.data.user.role, 'USER');
});

test('B3 空用户名 → 400', async () => {
  const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: '', password: 'x' }) });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
});

test('B4 空密码 → 400', async () => {
  const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'x', password: '' }) });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
});

test('B5 admin 错误密码 → 400', async () => {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'wrong' }),
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('B6 GET /api/auth/me 未登录 → user:null', async () => {
  const res = await api('/api/auth/me');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.user, null);
});

test('B7 登录后 GET /api/auth/me → 返回用户', async () => {
  const jar = new CookieJar();
  await login(jar, 'alice', 'pw1');
  const res = await api('/api/auth/me', { jar });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.username, 'alice');
  assert.equal(typeof res.body.data.user.id, 'string');
});

test('B8 篡改 payload → me 返回 user:null（签名校验生效）', async () => {
  const jar = new CookieJar();
  await login(jar, 'bob', 'pw1');
  const token = jar.get('kernel_session')!;
  const [encoded, sig] = token.split('.');
  // 篡改 payload：把 username 改成 attacker（不重新签名）
  const tamperedPayload = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')), username: 'attacker' }),
  ).toString('base64url');
  const forged = new CookieJar();
  forged.setFromResponse(
    new Response(null, { headers: { 'set-cookie': `kernel_session=${tamperedPayload}.${sig}; Path=/; HttpOnly` } }),
  );
  const res = await api('/api/auth/me', { jar: forged });
  assert.equal(res.body.data.user, null, '篡改 payload 后应视为未登录');
});

test('B9 篡改签名 → me 返回 user:null', async () => {
  const jar = new CookieJar();
  await login(jar, 'carol', 'pw1');
  const token = jar.get('kernel_session')!;
  const [encoded] = token.split('.');
  const forged = new CookieJar();
  forged.setFromResponse(
    new Response(null, { headers: { 'set-cookie': `kernel_session=${encoded}.AAAAAA; Path=/; HttpOnly` } }),
  );
  const res = await api('/api/auth/me', { jar: forged });
  assert.equal(res.body.data.user, null, '篡改签名后应视为未登录');
});

test('B10 POST /api/auth/logout → 清 cookie，me → user:null', async () => {
  const jar = new CookieJar();
  await login(jar, 'dave', 'pw1');
  const me1 = await api('/api/auth/me', { jar });
  assert.equal(me1.body.data.user.username, 'dave');

  const out = await api('/api/auth/logout', { method: 'POST', jar });
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);

  const me2 = await api('/api/auth/me', { jar });
  assert.equal(me2.body.data.user, null, '登出后 me 应返回 null');
});

/* ============================================================================
   阶段 C —— 投票
   ========================================================================== */

test('C1 未登录 POST /api/votes → 401 NOT_LOGGED_IN', async () => {
  const res = await api('/api/votes', { method: 'POST', body: JSON.stringify({ projectId: pubId }) });
  assert.equal(res.status, 401);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, 'NOT_LOGGED_IN');
});

test('C2 未登录 DELETE /api/votes/{id} → 401', async () => {
  const res = await api(`/api/votes/${pubId}`, { method: 'DELETE' });
  assert.equal(res.status, 401);
});

test('C3 未登录 GET /api/votes/me → 401', async () => {
  const res = await api('/api/votes/me');
  assert.equal(res.status, 401);
});

test('C4 登录后投票 → voted:true 且 voteCount 递增 1', async () => {
  const jar = new CookieJar();
  await login(jar, 'voter1', 'pw1');
  const before = await prisma.projectStats.findUnique({ where: { projectId: pubId } });
  const beforeCount = before?.voteCount ?? 0;

  const res = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: pubId }) });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.voted, true);
  assert.equal(res.body.data.voteCount, beforeCount + 1, '票数应 +1');
});

test('C5 重复投票幂等 → count 不重复 +1', async () => {
  const jar = new CookieJar();
  await login(jar, 'voter2', 'pw1');
  const first = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: pubId }) });
  const countAfterFirst = first.body.data.voteCount;

  const second = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: pubId }) });
  assert.equal(second.body.data.voted, true);
  assert.equal(second.body.data.voteCount, countAfterFirst, '重复投票票数不变');
});

test('C6 DELETE /api/votes/{id} → voted:false 且 count 减 1', async () => {
  const jar = new CookieJar();
  await login(jar, 'voter3', 'pw1');
  const v = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: pubId }) });
  const countAfterVote = v.body.data.voteCount;

  const d = await api(`/api/votes/${pubId}`, { method: 'DELETE', jar });
  assert.equal(d.status, 200);
  assert.equal(d.body.data.voted, false);
  assert.equal(d.body.data.voteCount, countAfterVote - 1, '取消后票数应 -1');
});

test('C7 重复取消幂等 → 票数不再减（下限 0）', async () => {
  const jar = new CookieJar();
  await login(jar, 'voter4', 'pw1');
  const d1 = await api(`/api/votes/${pubId}`, { method: 'DELETE', jar });
  const d2 = await api(`/api/votes/${pubId}`, { method: 'DELETE', jar });
  assert.equal(d1.body.data.voted, false);
  assert.equal(d2.body.data.voted, false);
  assert.equal(d2.body.data.voteCount, d1.body.data.voteCount, '重复取消票数不变');
  assert.ok(d2.body.data.voteCount >= 0, '票数不得为负');
});

test('C8 GET /api/votes/me → 我投过的 projectId 列表正确', async () => {
  const jar = new CookieJar();
  await login(jar, 'voter5', 'pw1');
  await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: pubId }) });
  await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: unlistedId }) });

  const res = await api('/api/votes/me', { jar });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const ids = res.body.data.map((x: { projectId: string }) => x.projectId);
  assert.ok(ids.includes(pubId), '列表应含 pubId');
  assert.ok(ids.includes(unlistedId), '列表应含 unlistedId');
  assert.equal(res.body.data.length, 2);
});

test('C9 不存在 projectId → 404 NOT_FOUND', async () => {
  const jar = new CookieJar();
  await login(jar, 'voter6', 'pw1');
  const res = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: ghostId }) });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('C10 ARCHIVED 作品 → 410 GONE_ARCHIVED', async () => {
  const jar = new CookieJar();
  await login(jar, 'voter7', 'pw1');
  const res = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: archId }) });
  assert.equal(res.status, 410);
  assert.equal(res.body.error.code, 'GONE_ARCHIVED');
});

test('C11 PRIVATE 作品 → 404 NOT_FOUND（与不存在一致）', async () => {
  const jar = new CookieJar();
  await login(jar, 'voter8', 'pw1');
  const res = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: privId }) });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('C12 UNLISTED 作品 → 可投', async () => {
  const jar = new CookieJar();
  await login(jar, 'voter9', 'pw1');
  const res = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: unlistedId }) });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.voted, true);
});

test('C13 空 projectId → 400 VALIDATION_FAILED', async () => {
  const jar = new CookieJar();
  await login(jar, 'voter10', 'pw1');
  const res = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: '' }) });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
});

test('C14 响应体统一信封：成功 {ok,data}、失败 {ok:false,error:{code,message}}', async () => {
  const jar = new CookieJar();
  await login(jar, 'voter11', 'pw1');
  const okRes = await api('/api/votes/me', { jar });
  assert.deepEqual(Object.keys(okRes.body).sort(), ['data', 'ok']);
  assert.equal(okRes.body.ok, true);

  // 注：DELETE 对「不存在」是幂等成功（service 契约：取消不存在票不报错），
  // 因此失败信封用「空白 projectId → 400 VALIDATION_FAILED」验证。
  const badRes = await api(`/api/votes/${encodeURIComponent(' ')}`, { method: 'DELETE', jar });
  assert.deepEqual(Object.keys(badRes.body).sort(), ['error', 'ok']);
  assert.equal(badRes.body.ok, false);
  assert.equal(typeof badRes.body.error.code, 'string');
  assert.equal(typeof badRes.body.error.message, 'string');
});
