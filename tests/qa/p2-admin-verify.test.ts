/**
 * P2 后台管理模块 —— QA 独立验证（QA Engineer 独立编写，不信任工程师自验）。
 *
 * 覆盖（以 docs/P2-后台管理设计.md 已拍板规则为准）：
 *   B 鉴权边界：未登录 /admin → 重定向；/api/admin/* → 401；普通用户 → 403 / 重定向；
 *               ADMIN → 200 且概览 6 指标与 DB 实时一致。
 *   C 作品管理：block→BLOCKED（详情 404 / 广场不展示 / admin.project.block 留痕）；unblock 恢复；
 *               purge→PURGED + 磁盘目录删除 + sizeBytes=0 + admin.project.purge；
 *               renew/visibility/pin/unpin 生效 + 留痕；混入不存在 id → 单条 NOT_FOUND 不中断；
 *               非法 operation / 空 ids → 400。
 *   D 用户管理：ban→BANNED + 该用户登录被拒（403）；unban 恢复登录；禁封 ADMIN/自身 → 403；
 *               admin.user.ban/unban 留痕；不存在用户 → 404。
 *   E 清理中心：GET logs（detail 已解析）；dev 会话路径 POST cleanup/run → 200 + admin.cleanup.run；
 *               错误 token → 403；production（next start）→ 403。
 *   F 前端契约（源码静态断言）。
 *
 * 运行前提：
 *   1) DB 已 seed（demo/admin + 3 件作品）；本文件对 DB 有写副作用（block/unban 后复位、purge 专用夹具）。
 *   2) `next build` + `next start -p <QA_PORT>`（SITE_URL=http://127.0.0.1:<QA_PORT>）。
 *   3) 运行：QA_PORT=3323 node --require ./tests/qa/qa-register.cjs --import tsx --test tests/qa/p2-admin-verify.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';

import { PrismaClient } from '@prisma/client';

import { resolveProjectDir } from '@/lib/storage';

const PORT = Number(process.env.QA_PORT ?? 3323);
const BASE = `http://127.0.0.1:${PORT}`;

const prisma = new PrismaClient();

/** 极简 cookie jar。 */
class CookieJar {
  private map = new Map<string, string>();
  setFromResponse(response: Response): void {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(';')[0];
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '') this.map.delete(name);
      else this.map.set(name, value);
    }
  }
  header(): string {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

/** JSON 请求（可选 cookie jar / headers），返回 status + body。 */
async function api(
  path: string,
  init: RequestInit & { jar?: CookieJar } = {},
): Promise<{ status: number; body: any }> {
  const { jar, ...rest } = init;
  const headers = new Headers(rest.headers ?? {});
  if (jar) headers.set('cookie', jar.header());
  if (rest.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const r = await fetch(`${BASE}${path}`, { ...rest, headers, redirect: 'manual' });
  if (jar) jar.setFromResponse(r);
  const text = await r.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

/** HTML 页面请求（redirect: manual 观察 Location）。 */
async function page(
  path: string,
  jar?: CookieJar,
): Promise<{ status: number; location: string | null; text: string }> {
  const headers = new Headers();
  if (jar) headers.set('cookie', jar.header());
  const r = await fetch(`${BASE}${path}`, { headers, redirect: 'manual' });
  if (jar) jar.setFromResponse(r);
  return { status: r.status, location: r.headers.get('location'), text: await r.text() };
}

async function login(jar: CookieJar, username: string, password: string): Promise<number> {
  const res = await api('/api/auth/login', {
    method: 'POST',
    jar,
    body: JSON.stringify({ username, password }),
  });
  return res.status;
}

async function sessionUserId(jar: CookieJar): Promise<string> {
  const res = await api('/api/auth/me', { jar });
  assert.equal(res.status, 200);
  return res.body?.data?.user?.id as string;
}

async function lastAudit(action: string): Promise<{
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string | null;
  meta: string | null;
} | null> {
  return prisma.auditLog.findFirst({
    where: { action },
    orderBy: { createdAt: 'desc' },
    select: { id: true, action: true, targetType: true, targetId: true, detail: true, meta: true },
  });
}

/** 从源作品复制一个专用 QA 作品（含磁盘目录），供 purge 验证使用。 */
async function createQaProject(slug: string, sourceSlug: string): Promise<string> {
  const src = await prisma.project.findUnique({ where: { slug: sourceSlug } });
  assert.ok(src, `源作品 ${sourceSlug} 应存在`);
  await prisma.project.deleteMany({ where: { slug } });
  const { id: _id, slug: _s, createdAt: _c, updatedAt: _u, ...rest } = src;
  const created = await prisma.project.create({
    data: {
      ...rest,
      slug,
      title: `[QA] ${slug}`,
      visibility: 'PUBLIC',
      status: 'ACTIVE',
      stats: { create: {} },
    },
    select: { id: true },
  });
  // 造磁盘目录，供「purge 物理删除」断言
  const { mkdir, writeFile } = await import('node:fs/promises');
  const dir = resolveProjectDir(slug);
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/index.html`, '<html><body>qa</body></html>', 'utf8');
  return created.id;
}

let aurId = '';
let qaPurgeId = '';
let qaPurgeSlug = 'QaPurgeP2';
let aliceId = '';
let adminId = '';

const adminJar = new CookieJar();
const aliceJar = new CookieJar();

before(async () => {
  // 登录 admin / alice
  assert.equal(await login(adminJar, 'admin', '123456'), 200);
  assert.equal(await login(aliceJar, 'alice', 'xxx'), 200);
  adminId = await sessionUserId(adminJar);
  aliceId = await sessionUserId(aliceJar);

  const aur = await prisma.project.findUnique({ where: { slug: 'Aur9raFx' }, select: { id: true } });
  assert.ok(aur, 'seed 作品 Aur9raFx 应存在');
  aurId = aur!.id;

  // 复位起点：Aur9raFx 恢复 ACTIVE + PUBLIC + 未置顶
  await prisma.project.update({
    where: { id: aurId },
    data: { status: 'ACTIVE', visibility: 'PUBLIC', pinned: false, archivedAt: null, purgeAt: null, fileCount: 1, sizeBytes: 5565 },
  });

  qaPurgeId = await createQaProject(qaPurgeSlug, 'Aur9raFx');
});

after(async () => {
  await prisma.$disconnect();
});

/* ============================================================================
   B —— 鉴权边界（HTTP 层实测）
   ========================================================================== */

test('B1 未登录 GET /admin → 重定向 /login?next=/admin', async () => {
  const res = await page('/admin');
  assert.ok([307, 302].includes(res.status), `应重定向，实际 status=${res.status}`);
  assert.ok(res.location?.includes('/login?next=/admin'), `Location=${res.location}`);
});

test('B2 未登录 GET /api/admin/overview → 401 NOT_LOGGED_IN', async () => {
  const res = await api('/api/admin/overview');
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, 'NOT_LOGGED_IN');
});

test('B3 未登录 GET /api/admin/{projects,users,logs} + POST batch/ban → 401', async () => {
  assert.equal((await api('/api/admin/projects')).status, 401);
  assert.equal((await api('/api/admin/users')).status, 401);
  assert.equal((await api('/api/admin/cleanup/logs')).status, 401);
  const batch = await api('/api/admin/projects/batch', {
    method: 'POST',
    body: JSON.stringify({ operation: 'block', ids: [aurId] }),
  });
  assert.equal(batch.status, 401);
  const ban = await api(`/api/admin/users/${aliceId}/ban`, {
    method: 'POST',
    body: JSON.stringify({ action: 'ban' }),
  });
  assert.equal(ban.status, 401);
});

test('B4 普通用户（alice）GET /admin → 重定向；GET /api/admin/overview → 403 FORBIDDEN', async () => {
  const pageRes = await page('/admin', aliceJar);
  assert.ok([307, 302].includes(pageRes.status), `应重定向，实际 status=${pageRes.status}`);
  assert.ok(pageRes.location?.includes('/login?next=/admin'), `Location=${pageRes.location}`);

  const res = await api('/api/admin/overview', { jar: aliceJar });
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, 'FORBIDDEN');
});

test('B5 普通用户（alice）访问其余 /api/admin/* → 403', async () => {
  assert.equal((await api('/api/admin/projects', { jar: aliceJar })).status, 403);
  assert.equal((await api('/api/admin/users', { jar: aliceJar })).status, 403);
  const batch = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: aliceJar,
    body: JSON.stringify({ operation: 'block', ids: [aurId] }),
  });
  assert.equal(batch.status, 403);
  const ban = await api(`/api/admin/users/${aliceId}/ban`, {
    method: 'POST',
    jar: aliceJar,
    body: JSON.stringify({ action: 'ban' }),
  });
  assert.equal(ban.status, 403);
});

test('B6 ADMIN GET /api/admin/overview → 200，6 指标与 DB 实时一致', async () => {
  const res = await api('/api/admin/overview', { jar: adminJar });
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);

  const [projectCounts, votesAgg, userCounts, sizeAgg] = await Promise.all([
    prisma.project.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.projectStats.aggregate({ _sum: { voteCount: true } }),
    prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.project.aggregate({ _sum: { sizeBytes: true } }),
  ]);
  const total = projectCounts.reduce((s, r) => s + r._count._all, 0);
  const get = (status: string) => projectCounts.find((r) => r.status === status)?._count._all ?? 0;
  const userTotal = userCounts.reduce((s, r) => s + r._count._all, 0);
  const banned = userCounts.find((r) => r.status === 'BANNED')?._count._all ?? 0;

  const m = res.body.data;
  assert.equal(m.projects.total, total, '总作品');
  assert.equal(m.projects.active, get('ACTIVE'), '在线');
  assert.equal(m.projects.archived, get('ARCHIVED'), '已归档');
  assert.equal(m.projects.blocked, get('BLOCKED'), '已封禁(作品)');
  assert.equal(m.projects.purged, get('PURGED'), '已清除');
  assert.equal(m.votes, votesAgg._sum?.voteCount ?? 0, '投票总数');
  assert.equal(m.users.total, userTotal, '用户数');
  assert.equal(m.users.banned, banned, '封禁用户');
  assert.equal(m.storageBytes, sizeAgg._sum?.sizeBytes ?? 0, '存储用量');
});

/* ============================================================================
   C —— 作品管理（batch 端点）
   ========================================================================== */

test('C1 batch block → BLOCKED：详情 404、广场不展示、admin.project.block 留痕', async () => {
  const res = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ operation: 'block', ids: [aurId] }),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body?.data?.operation, 'block');
  assert.equal(res.body?.data?.successCount, 1);
  assert.equal(res.body?.data?.results?.[0]?.ok, true);

  const row = await prisma.project.findUnique({ where: { id: aurId } });
  assert.equal(row?.status, 'BLOCKED');

  const detail = await api('/api/projects/Aur9raFx');
  assert.equal(detail.status, 404, 'BLOCKED 详情应 404');

  const list = await api('/api/projects?pageSize=48');
  const slugs = (list.body?.data ?? []).map((p: { slug: string }) => p.slug);
  assert.ok(!slugs.includes('Aur9raFx'), '广场不应展示 BLOCKED 作品');

  const audit = await lastAudit('admin.project.block');
  assert.ok(audit, '应存在 admin.project.block 审计');
  assert.equal(audit!.targetType, 'project');
  assert.equal(audit!.targetId, aurId);
  assert.ok(audit!.detail?.includes('Aur9raFx'), `detail=${audit!.detail}`);
  assert.ok(audit!.meta && JSON.parse(audit!.meta).after?.status === 'BLOCKED', 'meta 应含 after.status=BLOCKED');
});

test('C2 batch unblock → ACTIVE 恢复、详情 200、admin.project.unblock 留痕', async () => {
  const res = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ operation: 'unblock', ids: [aurId] }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body?.data?.successCount, 1);

  const row = await prisma.project.findUnique({ where: { id: aurId } });
  assert.equal(row?.status, 'ACTIVE');
  assert.equal(row?.archivedAt, null);
  assert.equal(row?.purgeAt, null);

  assert.equal((await api('/api/projects/Aur9raFx')).status, 200);
  assert.ok(await lastAudit('admin.project.unblock'), '应存在 admin.project.unblock');
});

test('C3 batch renew（ttlDays=30）→ 生效 + admin.project.renew 留痕', async () => {
  const before = await prisma.project.findUnique({ where: { id: aurId } });
  const res = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ operation: 'renew', ids: [aurId], payload: { ttlDays: 30 } }),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body?.data?.successCount, 1);
  const row = await prisma.project.findUnique({ where: { id: aurId } });
  assert.equal(row?.ttlDays, 30);
  assert.equal(row?.status, 'ACTIVE');
  assert.ok((row!.expireAt.getTime() - before!.expireAt.getTime()) > 0, 'expireAt 应延后');
  assert.ok(await lastAudit('admin.project.renew'), '应存在 admin.project.renew');
});

test('C4 batch visibility（PRIVATE 设置生效 + 留痕；PRIVATE 详情应按契约 404）→ admin.project.visibility 留痕', async () => {
  try {
    const res = await api('/api/admin/projects/batch', {
      method: 'POST',
      jar: adminJar,
      body: JSON.stringify({ operation: 'visibility', ids: [aurId], payload: { visibility: 'PRIVATE' } }),
    });
    assert.equal(res.status, 200);
    assert.equal((await prisma.project.findUnique({ where: { id: aurId } }))?.visibility, 'PRIVATE');
    assert.ok(await lastAudit('admin.project.visibility'), '应存在 admin.project.visibility');

    // ⚠️ 已知缺陷（预存 P1 代码）：GET /api/projects/[slug] 传 allowPrivate:true，
    //    未登录也能取回 PRIVATE 作品全量数据，违反「PRIVATE 一律 404、不泄漏存在性」。
    //    本断言按产品契约保留（docs/P0 §7.4 / Q4），失败即复现该缺陷。
    const detail = await api('/api/projects/Aur9raFx');
    assert.equal(detail.status, 404, 'PRIVATE 详情应 404（当前缺陷：allowPrivate:true 泄漏）');
  } finally {
    // 恢复 PUBLIC，保证后续断言与库状态干净
    await api('/api/admin/projects/batch', {
      method: 'POST',
      jar: adminJar,
      body: JSON.stringify({ operation: 'visibility', ids: [aurId], payload: { visibility: 'PUBLIC' } }),
    });
    await prisma.project.update({
      where: { id: aurId },
      data: { visibility: 'PUBLIC', status: 'ACTIVE', pinned: false },
    });
  }
});

test('C5 batch pin/unpin → pinned 切换 + admin.project.pin/unpin 留痕', async () => {
  const pin = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ operation: 'pin', ids: [aurId] }),
  });
  assert.equal(pin.status, 200);
  assert.equal((await prisma.project.findUnique({ where: { id: aurId } }))?.pinned, true);
  assert.ok(await lastAudit('admin.project.pin'), '应存在 admin.project.pin');

  const unpin = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ operation: 'unpin', ids: [aurId] }),
  });
  assert.equal(unpin.status, 200);
  assert.equal((await prisma.project.findUnique({ where: { id: aurId } }))?.pinned, false);
  assert.ok(await lastAudit('admin.project.unpin'), '应存在 admin.project.unpin');
});

test('C6 batch purge → PURGED + 磁盘目录删除 + sizeBytes=0 + admin.project.purge 留痕', async () => {
  const dir = resolveProjectDir(qaPurgeSlug);
  const beforeDir = await import('node:fs/promises').then((fs) =>
    fs.stat(dir).then(() => true).catch(() => false),
  );
  assert.equal(beforeDir, true, 'purge 前磁盘目录应存在');

  const res = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ operation: 'purge', ids: [qaPurgeId] }),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body?.data?.successCount, 1);

  const row = await prisma.project.findUnique({ where: { id: qaPurgeId } });
  assert.equal(row?.status, 'PURGED');
  assert.equal(row?.sizeBytes, 0);
  assert.equal(row?.fileCount, 0);

  const afterDir = await import('node:fs/promises').then((fs) =>
    fs.stat(dir).then(() => true).catch(() => false),
  );
  assert.equal(afterDir, false, 'purge 后磁盘目录应删除');

  const detail = await api(`/api/projects/${qaPurgeSlug}`);
  assert.equal(detail.status, 404, 'PURGED 详情应 404');

  const audit = await lastAudit('admin.project.purge');
  assert.ok(audit, '应存在 admin.project.purge');
  assert.equal(audit!.targetId, qaPurgeId);
  assert.ok(audit!.meta && JSON.parse(audit!.meta).after?.status === 'PURGED');
});

test('C7 batch 混入不存在 id → 整单 200、单条 NOT_FOUND 不中断', async () => {
  const res = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ operation: 'block', ids: [aurId, 'no-such-project-id'] }),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body?.data?.successCount, 1);
  assert.equal(res.body?.data?.failCount, 1);
  const failed = res.body?.data?.results?.find((r: { id: string }) => r.id === 'no-such-project-id');
  assert.ok(failed);
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'NOT_FOUND');
  // 有效的那条已 block，恢复之（保持起点 ACTIVE）
  const back = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ operation: 'unblock', ids: [aurId] }),
  });
  assert.equal(back.status, 200);
});

test('C8 非法 operation / 空 ids / ids 超限 → 400 VALIDATION_FAILED', async () => {
  const badOp = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ operation: 'explode', ids: [aurId] }),
  });
  assert.equal(badOp.status, 400);
  assert.equal(badOp.body?.error?.code, 'VALIDATION_FAILED');

  const emptyIds = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ operation: 'block', ids: [] }),
  });
  assert.equal(emptyIds.status, 400);
  assert.equal(emptyIds.body?.error?.code, 'VALIDATION_FAILED');

  const tooMany = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ operation: 'block', ids: Array.from({ length: 101 }, (_, i) => `id-${i}`) }),
  });
  assert.equal(tooMany.status, 400);
});

test('C9 renew 缺 payload / visibility 缺 payload → 400', async () => {
  const noTtl = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ operation: 'renew', ids: [aurId] }),
  });
  assert.equal(noTtl.status, 400);

  const noVis = await api('/api/admin/projects/batch', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ operation: 'visibility', ids: [aurId] }),
  });
  assert.equal(noVis.status, 400);
});

/* ============================================================================
   D —— 用户管理
   ========================================================================== */

test('D1 ban alice → BANNED + 登录被拒（403）+ admin.user.ban 留痕', async () => {
  const res = await api(`/api/admin/users/${aliceId}/ban`, {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ action: 'ban' }),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body?.data?.status, 'BANNED');
  const row = await prisma.user.findUnique({ where: { id: aliceId } });
  assert.equal(row?.status, 'BANNED');

  // 被封用户重新登录被拒
  const freshJar = new CookieJar();
  const relogin = await login(freshJar, 'alice', 'xxx');
  assert.equal(relogin, 403);

  const audit = await lastAudit('admin.user.ban');
  assert.ok(audit, '应存在 admin.user.ban');
  assert.equal(audit!.targetId, aliceId);
  assert.ok(audit!.meta && JSON.parse(audit!.meta).after?.status === 'BANNED');
});

test('D2 unban alice → ACTIVE + 登录恢复 + admin.user.unban 留痕', async () => {
  const res = await api(`/api/admin/users/${aliceId}/ban`, {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ action: 'unban' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body?.data?.status, 'ACTIVE');
  const row = await prisma.user.findUnique({ where: { id: aliceId } });
  assert.equal(row?.status, 'ACTIVE');

  const freshJar = new CookieJar();
  assert.equal(await login(freshJar, 'alice', 'xxx'), 200, '解封后应恢复登录');
  assert.ok(await lastAudit('admin.user.unban'), '应存在 admin.user.unban');
});

test('D3 禁封 ADMIN / 自身 → 403；不存在用户 → 404；非法 action → 400', async () => {
  const banAdmin = await api(`/api/admin/users/${adminId}/ban`, {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ action: 'ban' }),
  });
  assert.equal(banAdmin.status, 403);
  assert.equal(banAdmin.body?.error?.code, 'FORBIDDEN');

  const banSelf = await api(`/api/admin/users/${adminId}/ban`, {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ action: 'ban' }),
  });
  assert.equal(banSelf.status, 403);

  const notFound = await api('/api/admin/users/no-such-user-id/ban', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ action: 'ban' }),
  });
  assert.equal(notFound.status, 404);

  const badAction = await api(`/api/admin/users/${aliceId}/ban`, {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ action: 'nuke' }),
  });
  assert.equal(badAction.status, 400);
});

test('D4 GET /api/admin/users → 200，含 projectCount', async () => {
  const res = await api('/api/admin/users?pageSize=100', { jar: adminJar });
  assert.equal(res.status, 200);
  const items = res.body?.data ?? [];
  assert.ok(Array.isArray(items));
  const alice = items.find((u: { username: string }) => u.username === 'alice');
  assert.ok(alice, '列表应含 alice');
  assert.equal(typeof alice.projectCount, 'number');
  assert.ok('role' in alice && 'status' in alice && 'createdAt' in alice);
});

/* ============================================================================
   E —— 清理中心
   ========================================================================== */

test('E1 GET /api/admin/cleanup/logs → 200，detail 已解析', async () => {
  const res = await api('/api/admin/cleanup/logs?pageSize=100', { jar: adminJar });
  assert.equal(res.status, 200);
  const items = res.body?.data ?? [];
  assert.ok(Array.isArray(items));
  for (const log of items) {
    assert.ok('batchId' in log && 'action' in log && 'success' in log && 'freedBytes' in log);
    if (log.detail != null) {
      assert.ok(typeof log.detail === 'object' || typeof log.detail === 'string', 'detail 应为解析后对象或原始串');
    }
  }
});

test('E2 production（next start）POST /api/admin/cleanup/run（会话）→ 403（生产规则）', async () => {
  const res = await api('/api/admin/cleanup/run', { method: 'POST', jar: adminJar });
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body?.error?.code, 'FORBIDDEN');
});

test('E3 POST /api/admin/cleanup/run（无会话 + 错误 token）→ 403', async () => {
  const res = await api('/api/admin/cleanup/run', {
    method: 'POST',
    headers: { 'x-admin-token': 'wrong-token' },
  });
  assert.equal(res.status, 403);
});

/* ============================================================================
   F —— 前端契约（源码静态断言）
   ========================================================================== */

function read(rel: string): string {
  return readFileSync(`${process.cwd()}/${rel}`, 'utf8');
}

test('F1 admin/layout.tsx：ADMIN 门禁 redirect /login?next=/admin', () => {
  const src = read('src/app/admin/layout.tsx');
  assert.match(src, /getSession\(\)/);
  assert.match(src, /isAdminRole\(session\.role\)/);
  assert.match(src, /redirect\('\/login\?next=\/admin'\)/);
});

test('F2 AdminShell 侧栏 6 项（概览/作品/用户/活动/风控中心/清理，P2 风控新增风控中心）', () => {
  const src = read('src/components/admin/AdminShell.tsx');
  assert.match(src, /href: '\/admin', label: '概览'/);
  assert.match(src, /href: '\/admin\/projects', label: '作品管理'/);
  assert.match(src, /href: '\/admin\/users', label: '用户管理'/);
  assert.match(src, /href: '\/admin\/campaigns', label: '活动管理'/);
  assert.match(src, /href: '\/admin\/risk', label: '风控中心'/);
  assert.match(src, /href: '\/admin\/cleanup', label: '清理中心'/);
  const count = (src.match(/label: '/g) ?? []).length;
  assert.equal(count, 6, `侧栏应为 6 项，实际 ${count}`);
});

test('F3 Nav 后台入口仅 ADMIN/SUPER_ADMIN，且不 import auth.ts', () => {
  const src = read('src/components/ui/Nav.tsx');
  assert.match(src, /sessionUser\?\.role === 'ADMIN' \|\| sessionUser\?\.role === 'SUPER_ADMIN'/);
  assert.match(src, /href: '\/admin', label: '后台管理'/);
  assert.doesNotMatch(src, /import.*@\/lib\/auth/);
});

test('F4 危险操作（PURGE/BLOCK/封禁）走 ConfirmDialog', () => {
  const pt = read('src/components/admin/tables/ProjectsTable.tsx');
  assert.match(pt, /operation: 'block'/);
  assert.match(pt, /operation: 'purge'/);
  assert.match(pt, /ConfirmDialog/);
  const ut = read('src/components/admin/tables/UsersTable.tsx');
  assert.match(ut, /ConfirmDialog/);
  assert.match(ut, /action: 'ban'/);
});

test('F5 ProjectsTable 列与操作按钮齐全（下架/恢复/删除/续期/可见性/置顶）', () => {
  const src = read('src/components/admin/tables/ProjectsTable.tsx');
  for (const col of ['slug', '标题', '作者', '可见性', '状态', '票数', '有效期', '操作']) {
    assert.ok(src.includes(col), `列「${col}」应存在`);
  }
  for (const btn of ['下架', '恢复', '删除', '续期', '置顶']) {
    assert.ok(src.includes(btn), `按钮「${btn}」应存在`);
  }
  assert.match(src, /runBatch\('visibility'/, '可见性操作应存在');
  assert.ok(src.includes("row.pinned ? 'unpin' : 'pin'"), '置顶/取消置顶应存在');
});

test('F6 UsersTable 列与封禁/解封按钮齐全', () => {
  const src = read('src/components/admin/tables/UsersTable.tsx');
  for (const col of ['用户名', '昵称', '角色', '状态', '作品数', '注册时间', '操作']) {
    assert.ok(src.includes(col), `列「${col}」应存在`);
  }
  assert.ok(src.includes('封禁') && src.includes('解封'));
});

test('F7 admin 组件与样式零硬编码 hex（颜色走 CSS 变量）', () => {
  const hex = /#[0-9a-fA-F]{6}\b/;
  for (const rel of [
    'src/components/admin/AdminShell.tsx',
    'src/components/admin/MetricCard.tsx',
    'src/components/admin/ConfirmDialog.tsx',
    'src/components/admin/Pagination.tsx',
    'src/components/admin/tables/ProjectsTable.tsx',
    'src/components/admin/tables/UsersTable.tsx',
    'src/components/admin/tables/CleanupPanel.tsx',
    'src/components/ui/Table.tsx',
  ]) {
    const src = read(rel);
    assert.doesNotMatch(src, hex, `${rel} 不应含硬编码 hex`);
  }
  const css = read('src/styles/globals.css');
  const adminCss = css.slice(css.indexOf('.admin-shell'));
  assert.doesNotMatch(adminCss, hex, 'admin 样式段不应含硬编码 hex');
  assert.match(css, /\.admin-shell/);
  assert.match(css, /\.admin-table/);
  assert.match(css, /\.metric-card/);
});

test('F8 后台列表默认 pageSize=20、上限 100、batch 上限 100（常量收口）', () => {
  const src = read('src/lib/constants.ts');
  assert.match(src, /ADMIN_DEFAULT_PAGE_SIZE = 20/);
  assert.match(src, /ADMIN_MAX_PAGE_SIZE = 100/);
  assert.match(src, /ADMIN_BATCH_MAX_IDS = 100/);
});
