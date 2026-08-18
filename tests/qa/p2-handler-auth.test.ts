/**
 * P1 收尾 QA 独立验证 —— Route Handler 直接调用（无 Next 服务器）。
 *
 * 通过 qa-loader.mjs 把 `next/headers` stub 化，直接调用真实 Route Handler，
 * 验证发布与管理鉴权边界的完整矩阵（401 / 403 / 200 / authorId 注入）。
 *
 * 运行：DATABASE_URL=... KERNEL_DATA_DIR=... node --import tsx
 *       --import ./tests/qa/qa-loader.mjs --test tests/qa/p2-handler-auth.test.ts
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';

import type { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';

import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { LOCAL_DEMO_USER_ID } from '@/lib/constants';
import * as projectsRoute from '@/app/api/projects/route';
import * as slugRoute from '@/app/api/projects/[slug]/route';
import * as renewRoute from '@/app/api/projects/[slug]/renew/route';
import * as uploadInitRoute from '@/app/api/projects/upload-init/route';
import * as uploadChunkRoute from '@/app/api/projects/upload-chunk/route';
import * as uploadCompleteRoute from '@/app/api/projects/upload-complete/route';

const prisma = new PrismaClient();

/** 设置当前请求的会话 cookie（null = 未登录）。 */
function setCookie(token: string | null): void {
  (globalThis as any).__qaCookies = new Map(token ? [[SESSION_COOKIE, token]] : []);
}

/** 构造 handler 可用的 Request（NextRequest 的扩展属性在单测中未使用，做类型收窄）。 */
function req(path: string, init: RequestInit = {}): NextRequest {
  return new Request(`http://localhost${path}`, init) as NextRequest;
}

function ctx(slug: string): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

function tokenFor(userId: string, username: string, role: string): string {
  return createSessionToken({ id: userId, username, role });
}

const DEMO = { id: LOCAL_DEMO_USER_ID, username: 'demo', role: 'USER' };
const ALICE = { id: 'alice-test-id', username: 'alice', role: 'USER' };
const ADMIN = { id: 'admin-test-id', username: 'admin', role: 'ADMIN' };
const SLUG = 'Aur9raFx';

before(async () => {
  // 确保 Aur9raFx 是 ACTIVE 起点
  await prisma.project.updateMany({ where: { slug: SLUG }, data: { status: 'ACTIVE', archivedAt: null, purgeAt: null } });
});

after(async () => {
  await prisma.$disconnect();
});

/* ============================================================================
   未登录 → 401 NOT_LOGGED_IN
   ========================================================================== */

test('H1 未登录 POST /api/projects → 401 NOT_LOGGED_IN', async () => {
  setCookie(null);
  const res = await projectsRoute.POST(req('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'x', externalUrl: 'https://example.com/x' }),
  }));
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'NOT_LOGGED_IN');
});

test('H2 未登录 POST upload-init → 401', async () => {
  setCookie(null);
  const res = await uploadInitRoute.POST(req('/api/projects/upload-init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName: 'a.html', fileSize: 100, mode: 'SINGLE_FILE' }),
  }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'NOT_LOGGED_IN');
});

test('H3 未登录 POST upload-chunk → 401', async () => {
  setCookie(null);
  const form = new FormData();
  form.set('uploadId', 'x');
  form.set('index', '0');
  form.set('chunk', new Blob(['a']));
  const res = await uploadChunkRoute.POST(req('/api/projects/upload-chunk', { method: 'POST', body: form }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'NOT_LOGGED_IN');
});

test('H4 未登录 POST upload-complete → 401', async () => {
  setCookie(null);
  const res = await uploadCompleteRoute.POST(req('/api/projects/upload-complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uploadId: 'x' }),
  }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'NOT_LOGGED_IN');
});

test('H5 未登录 PATCH /api/projects/{slug} → 401', async () => {
  setCookie(null);
  const res = await slugRoute.PATCH(req(`/api/projects/${SLUG}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Aurora Field 极光粒子场' }),
  }), ctx(SLUG));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'NOT_LOGGED_IN');
});

test('H6 未登录 DELETE /api/projects/{slug} → 401', async () => {
  setCookie(null);
  const res = await slugRoute.DELETE(req(`/api/projects/${SLUG}`, { method: 'DELETE' }), ctx(SLUG));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'NOT_LOGGED_IN');
});

test('H7 未登录 POST renew → 401', async () => {
  setCookie(null);
  const res = await renewRoute.POST(req(`/api/projects/${SLUG}/renew`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ttlDays: 30 }),
  }), ctx(SLUG));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'NOT_LOGGED_IN');
});

test('H8 篡改签名 token → 视为未登录 401', async () => {
  const valid = createSessionToken(DEMO);
  const [encoded] = valid.split('.');
  setCookie(`${encoded}.AAAAAA`);
  const res = await projectsRoute.POST(req('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'x', externalUrl: 'https://example.com/x' }),
  }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'NOT_LOGGED_IN');
});

/* ============================================================================
   作者 / 管理员 → 200；非作者 → 403
   ========================================================================== */

test('H9 作者 PATCH 自己的作品 → 200 且 authorId 归属作者', async () => {
  setCookie(tokenFor(DEMO.id, DEMO.username, DEMO.role));
  const res = await slugRoute.PATCH(req(`/api/projects/${SLUG}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Aurora Field 极光粒子场', summary: 'handler QA 摘要' }),
  }), ctx(SLUG));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.authorId, DEMO.id);
});

test('H10 作者 renew → 200', async () => {
  setCookie(tokenFor(DEMO.id, DEMO.username, DEMO.role));
  const res = await renewRoute.POST(req(`/api/projects/${SLUG}/renew`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ttlDays: 30 }),
  }), ctx(SLUG));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.status, 'ACTIVE');
  assert.equal(body.data.ttlDays, 30);
});

test('H11 非作者 PATCH → 403 FORBIDDEN', async () => {
  setCookie(tokenFor(ALICE.id, ALICE.username, ALICE.role));
  const res = await slugRoute.PATCH(req(`/api/projects/${SLUG}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'hack' }),
  }), ctx(SLUG));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'FORBIDDEN');
});

test('H12 非作者 DELETE → 403', async () => {
  setCookie(tokenFor(ALICE.id, ALICE.username, ALICE.role));
  const res = await slugRoute.DELETE(req(`/api/projects/${SLUG}`, { method: 'DELETE' }), ctx(SLUG));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'FORBIDDEN');
});

test('H13 非作者 renew → 403', async () => {
  setCookie(tokenFor(ALICE.id, ALICE.username, ALICE.role));
  const res = await renewRoute.POST(req(`/api/projects/${SLUG}/renew`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ttlDays: 30 }),
  }), ctx(SLUG));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'FORBIDDEN');
});

test('H14 ADMIN PATCH → 200（越权）', async () => {
  setCookie(tokenFor(ADMIN.id, ADMIN.username, ADMIN.role));
  const res = await slugRoute.PATCH(req(`/api/projects/${SLUG}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ summary: 'handler QA admin 摘要' }),
  }), ctx(SLUG));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('H15 ADMIN renew → 200（越权）', async () => {
  setCookie(tokenFor(ADMIN.id, ADMIN.username, ADMIN.role));
  const res = await renewRoute.POST(req(`/api/projects/${SLUG}/renew`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ttlDays: 90 }),
  }), ctx(SLUG));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('H16 作者 DELETE → 200 ARCHIVED；作者 renew → ACTIVE 复活', async () => {
  setCookie(tokenFor(DEMO.id, DEMO.username, DEMO.role));
  const del = await slugRoute.DELETE(req(`/api/projects/${SLUG}`, { method: 'DELETE' }), ctx(SLUG));
  assert.equal(del.status, 200);
  const delBody = await del.json();
  assert.equal(delBody.data.status, 'ARCHIVED');
  assert.ok(delBody.data.purgeAt, '应带 purgeAt');

  const renew = await renewRoute.POST(req(`/api/projects/${SLUG}/renew`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ttlDays: 30 }),
  }), ctx(SLUG));
  assert.equal(renew.status, 200);
  assert.equal((await renew.json()).data.status, 'ACTIVE');
});

test('H17 ADMIN DELETE → 200；ADMIN renew → ACTIVE 复活', async () => {
  setCookie(tokenFor(ADMIN.id, ADMIN.username, ADMIN.role));
  const del = await slugRoute.DELETE(req(`/api/projects/${SLUG}`, { method: 'DELETE' }), ctx(SLUG));
  assert.equal(del.status, 200);
  assert.equal((await del.json()).data.status, 'ARCHIVED');

  const renew = await renewRoute.POST(req(`/api/projects/${SLUG}/renew`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ttlDays: 90 }),
  }), ctx(SLUG));
  assert.equal(renew.status, 200);
  assert.equal((await renew.json()).data.status, 'ACTIVE');
});

/* ============================================================================
   创建与公开列表
   ========================================================================== */

test('H18 未登录 GET /api/projects → 200（列表公开）', async () => {
  setCookie(null);
  const res = await projectsRoute.GET(req('/api/projects?pageSize=48'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.data));
  assert.ok((body.meta?.total ?? 0) >= 3);
  const slugs = body.data.map((p: { slug: string }) => p.slug);
  assert.ok(slugs.includes('Aur9raFx'));
  assert.ok(!slugs.includes('PuLse7Kd'), 'UNLISTED 不出现在广场');
});

test('H19 登录 POST /api/projects（外链 + 脏 authorId）→ 201 且作者归会话', async () => {
  setCookie(tokenFor(DEMO.id, DEMO.username, DEMO.role));
  const dirty = 'dirty-author-id-must-be-overridden';
  const res = await projectsRoute.POST(req('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Handler QA 外链作品',
      externalUrl: 'https://example.com/handler-qa',
      authorId: dirty,
    }),
  }));
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  const body = await res.json();
  const slug = body.data.slug;
  assert.ok(typeof slug === 'string' && slug.length === 8);

  // GET 详情验证作者归属
  setCookie(null); // 详情公开（PUBLIC）
  const detailRes = await slugRoute.GET(req(`/api/projects/${slug}`), ctx(slug));
  assert.equal(detailRes.status, 200);
  const detail = await detailRes.json();
  assert.equal(detail.data.authorId, DEMO.id, 'authorId 必须来自会话');
  assert.notEqual(detail.data.authorId, dirty, '脏 authorId 被覆盖');
  assert.equal(detail.data.externalUrl, 'https://example.com/handler-qa');

  // 清理（作者删除）
  setCookie(tokenFor(DEMO.id, DEMO.username, DEMO.role));
  const del = await slugRoute.DELETE(req(`/api/projects/${slug}`, { method: 'DELETE' }), ctx(slug));
  assert.equal(del.status, 200);
});
