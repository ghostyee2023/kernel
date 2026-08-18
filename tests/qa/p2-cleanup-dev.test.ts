/**
 * P2 清理中心 —— dev 模式 POST /api/admin/cleanup/run 直调 Route Handler 验证。
 *
 * 设计（Q4）：dev 下「ADMIN 会话 或 X-Admin-Token 任一通过」；production 一律 403。
 * `next start` 会强制 NODE_ENV=production，因此会话路径必须脱离服务器直调 handler，
 * 并在调用前把 process.env.NODE_ENV 切到 development。
 *
 * 运行：node --require ./tests/qa/qa-register.cjs --import tsx --test tests/qa/p2-cleanup-dev.test.ts
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';

import type { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';

import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import * as cleanupRunRoute from '@/app/api/admin/cleanup/run/route';

const prisma = new PrismaClient();

function setCookie(token: string | null): void {
  (globalThis as any).__qaCookies = new Map(token ? [[SESSION_COOKIE, token]] : []);
}

function req(path: string, init: RequestInit = {}): NextRequest {
  return new Request(`http://localhost${path}`, init) as NextRequest;
}

let adminToken = '';
let adminId = '';

before(async () => {
  const admin = await prisma.user.findFirst({ where: { username: 'admin' }, select: { id: true } });
  assert.ok(admin, 'admin 用户应存在');
  adminId = admin!.id;
  adminToken = createSessionToken({ id: adminId, username: 'admin', role: 'ADMIN' });
});

after(async () => {
  await prisma.$disconnect();
});

test('DEV 会话路径 POST /api/admin/cleanup/run → 200 + admin.cleanup.run 留痕', async () => {
  (process.env as { NODE_ENV?: string }).NODE_ENV = 'development';
  setCookie(adminToken);
  const res = await cleanupRunRoute.POST(req('/api/admin/cleanup/run', { method: 'POST' }));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.data?.batchId, '应返回 batchId');
  assert.ok(body.data?.totals, '应返回 totals');

  const audit = await prisma.auditLog.findFirst({ where: { action: 'admin.cleanup.run' }, orderBy: { createdAt: 'desc' } });
  assert.ok(audit, '应存在 admin.cleanup.run 审计');
  assert.equal(audit!.targetType, 'cleanup');
  assert.equal(audit!.targetId, body.data.batchId);
  assert.ok(audit!.meta && JSON.parse(audit!.meta).batchId === body.data.batchId, 'meta 应含 batchId');
});

test('DEV 无会话 + 正确 token → 200（token 路径兼容）', async () => {
  (process.env as { NODE_ENV?: string }).NODE_ENV = 'development';
  setCookie(null);
  const res = await cleanupRunRoute.POST(
    req('/api/admin/cleanup/run', { method: 'POST', headers: { 'x-admin-token': 'dev-only-token' } }),
  );
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
});

test('DEV 无会话 + 错误 token → 403 FORBIDDEN', async () => {
  (process.env as { NODE_ENV?: string }).NODE_ENV = 'development';
  setCookie(null);
  const res = await cleanupRunRoute.POST(
    req('/api/admin/cleanup/run', { method: 'POST', headers: { 'x-admin-token': 'nope' } }),
  );
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, 'FORBIDDEN');
});

test('PRODUCTION 会话 POST /api/admin/cleanup/run → 403（生产规则）', async () => {
  (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
  setCookie(adminToken);
  const res = await cleanupRunRoute.POST(req('/api/admin/cleanup/run', { method: 'POST' }));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, 'FORBIDDEN');
});
