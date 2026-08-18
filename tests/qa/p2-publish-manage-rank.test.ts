/**
 * P1 收尾 QA 独立验证（QA Engineer 独立编写，不信任工程师自验）——
 * 发布与管理鉴权边界 + 排行榜页 /rank。
 *
 * 运行前提（由 QA 脚本保证）：
 *   1) temp 副本已 db:seed（demo / admin / 3 件 seed 作品，Aur9raFx 作者=demo）
 *   2) `next build` 已完成，`next start -p <QA_PORT>` 已起（SITE_URL=http://127.0.0.1:<QA_PORT>）
 *   3) 本文件以 `node --import tsx --test tests/qa/p2-publish-manage-rank.test.ts` 运行
 *
 * 覆盖（以已拍板产品规则为准）：
 *   B 鉴权边界：未登录三上传 API + POST /api/projects → 401；
 *               PATCH/DELETE/renew 未登录 401 / 非作者 403 / 作者 200 / ADMIN 200；
 *               POST authorId 必须来自会话（脏字段被覆盖）；
 *               GET /api/projects 公开。
 *   C 前端引导：/new 未登录引导卡 / 已登录向导；/status 操作区 canManage 条件渲染；
 *               Nav 含 /rank。
 *   D 排行榜：只收 PUBLIC+ACTIVE+voteCount>0；2/1/3 podium + medal；
 *              按票数倒序；无 UNLISTED/PRIVATE/ARCHIVED；榜单项指向 /w/[slug]；空态。
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';

import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.QA_PORT ?? 3323);
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = `http://127.0.0.1:${PORT}`;

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

/** JSON 请求（可选 cookie jar），返回 status + body。 */
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

/** HTML 页面请求。 */
async function page(path: string, jar?: CookieJar): Promise<{ status: number; text: string }> {
  const headers = new Headers();
  if (jar) headers.set('cookie', jar.header());
  const r = await fetch(`${BASE}${path}`, { headers, redirect: 'manual' });
  if (jar) jar.setFromResponse(r);
  return { status: r.status, text: await r.text() };
}

/** 登录并返回 jar。 */
async function login(jar: CookieJar, username: string, password: string): Promise<number> {
  const res = await api('/api/auth/login', {
    method: 'POST',
    jar,
    body: JSON.stringify({ username, password }),
  });
  return res.status;
}

/** 记录会话用户 id。 */
async function sessionUserId(jar: CookieJar): Promise<string> {
  const res = await api('/api/auth/me', { jar });
  assert.equal(res.status, 200);
  assert.ok(res.body?.data?.user?.id, 'me 应返回用户 id');
  return res.body.data.user.id as string;
}

let demoUserId = '';
const demoJar = new CookieJar();
const aliceJar = new CookieJar();
const adminJar = new CookieJar();
const qaArchSlug = 'QaArchP2';
const qaPrivSlug = 'QaPrivP2';
/** 额外 PUBLIC ACTIVE 作品，用于凑满 podium TOP3 + ranklist #4。 */
const p2aSlug = 'P2RankAa';
const p2bSlug = 'P2RankBb';

before(async () => {
  // 全量清票，起点确定
  await prisma.vote.deleteMany({});
  await prisma.projectStats.updateMany({ data: { voteCount: 0 } });

  const src = await prisma.project.findUnique({ where: { slug: 'Aur9raFx' } });
  assert.ok(src, 'seed 作品 Aur9raFx 应存在');

  // 造 ARCHIVED / PRIVATE 夹具 + 2 件 PUBLIC ACTIVE 排名作品（拷贝 seed 作品结构）
  const specs = [
    { slug: qaArchSlug, title: '[QA] ARCHIVED', visibility: 'PUBLIC', status: 'ARCHIVED', createdAt: new Date(Date.now() - 4000) },
    { slug: qaPrivSlug, title: '[QA] PRIVATE', visibility: 'PRIVATE', status: 'ACTIVE', createdAt: new Date(Date.now() - 3000) },
    { slug: p2bSlug, title: 'QA 排名乙', visibility: 'PUBLIC', status: 'ACTIVE', createdAt: new Date(Date.now() - 2000) },
    { slug: p2aSlug, title: 'QA 排名甲', visibility: 'PUBLIC', status: 'ACTIVE', createdAt: new Date(Date.now() - 1000) },
  ];
  for (const spec of specs) {
    await prisma.project.deleteMany({ where: { slug: spec.slug } });
    const { id: _id, slug: _s, createdAt: _c, updatedAt: _u, ...rest } = src;
    await prisma.project.create({
      data: {
        ...rest,
        slug: spec.slug,
        title: spec.title,
        visibility: spec.visibility,
        status: spec.status,
        createdAt: spec.createdAt,
        stats: { create: {} },
      },
    });
  }

  // 登录三账户
  assert.equal(await login(demoJar, 'demo', 'any-pw'), 200);
  assert.equal(await login(aliceJar, 'alice', 'xxx'), 200);
  assert.equal(await login(adminJar, 'admin', '123456'), 200);
  demoUserId = await sessionUserId(demoJar);
});

after(async () => {
  await prisma.$disconnect();
});

/* ============================================================================
   B —— 鉴权边界（HTTP 层）
   ========================================================================== */

test('B1 未登录 POST upload-init → 401 NOT_LOGGED_IN', async () => {
  const res = await api('/api/projects/upload-init', {
    method: 'POST',
    body: JSON.stringify({ fileName: 'a.html', fileSize: 100, mode: 'SINGLE_FILE' }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.body?.ok, false);
  assert.equal(res.body?.error?.code, 'NOT_LOGGED_IN');
});

test('B2 未登录 POST upload-chunk → 401 NOT_LOGGED_IN', async () => {
  const form = new FormData();
  form.set('uploadId', 'x');
  form.set('index', '0');
  form.set('chunk', new Blob(['a']));
  const res = await api('/api/projects/upload-chunk', { method: 'POST', body: form });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, 'NOT_LOGGED_IN');
});

test('B3 未登录 POST upload-complete → 401 NOT_LOGGED_IN', async () => {
  const res = await api('/api/projects/upload-complete', {
    method: 'POST',
    body: JSON.stringify({ uploadId: 'x' }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, 'NOT_LOGGED_IN');
});

test('B4 未登录 POST /api/projects → 401 NOT_LOGGED_IN', async () => {
  const res = await api('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title: '未登录', externalUrl: 'https://example.com/x' }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, 'NOT_LOGGED_IN');
});

test('B5 未登录 PATCH /api/projects/Aur9raFx → 401', async () => {
  const res = await api('/api/projects/Aur9raFx', {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Aurora Field 极光粒子场' }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, 'NOT_LOGGED_IN');
});

test('B6 未登录 DELETE /api/projects/Aur9raFx → 401', async () => {
  const res = await api('/api/projects/Aur9raFx', { method: 'DELETE' });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, 'NOT_LOGGED_IN');
});

test('B7 未登录 POST /api/projects/Aur9raFx/renew → 401', async () => {
  const res = await api('/api/projects/Aur9raFx/renew', {
    method: 'POST',
    body: JSON.stringify({ ttlDays: 30 }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, 'NOT_LOGGED_IN');
});

test('B8 作者（demo）PATCH 自己的作品 → 200', async () => {
  const res = await api('/api/projects/Aur9raFx', {
    method: 'PATCH',
    jar: demoJar,
    body: JSON.stringify({ title: 'Aurora Field 极光粒子场', summary: 'QA 验证摘要' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.data?.title, 'Aurora Field 极光粒子场');
  assert.equal(res.body?.data?.authorId, demoUserId);
});

test('B9 作者（demo）renew 自己的作品 → 200', async () => {
  const res = await api('/api/projects/Aur9raFx/renew', {
    method: 'POST',
    jar: demoJar,
    body: JSON.stringify({ ttlDays: 30 }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.data?.status, 'ACTIVE');
  assert.equal(res.body?.data?.ttlDays, 30);
});

test('B10 非作者（alice）PATCH Aur9raFx → 403 FORBIDDEN', async () => {
  const res = await api('/api/projects/Aur9raFx', {
    method: 'PATCH',
    jar: aliceJar,
    body: JSON.stringify({ title: 'hack' }),
  });
  assert.equal(res.status, 403);
  assert.equal(res.body?.ok, false);
  assert.equal(res.body?.error?.code, 'FORBIDDEN');
});

test('B11 非作者（alice）DELETE Aur9raFx → 403', async () => {
  const res = await api('/api/projects/Aur9raFx', { method: 'DELETE', jar: aliceJar });
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, 'FORBIDDEN');
});

test('B12 非作者（alice）renew Aur9raFx → 403', async () => {
  const res = await api('/api/projects/Aur9raFx/renew', {
    method: 'POST',
    jar: aliceJar,
    body: JSON.stringify({ ttlDays: 30 }),
  });
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, 'FORBIDDEN');
});

test('B13 ADMIN PATCH Aur9raFx → 200（越权）', async () => {
  const res = await api('/api/projects/Aur9raFx', {
    method: 'PATCH',
    jar: adminJar,
    body: JSON.stringify({ summary: 'QA 管理员验证摘要' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);
});

test('B14 ADMIN renew Aur9raFx → 200（越权）', async () => {
  const res = await api('/api/projects/Aur9raFx/renew', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ ttlDays: 90 }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);
});

test('B15 未登录 GET /api/projects → 200（列表公开）', async () => {
  const res = await api('/api/projects?pageSize=48');
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);
  assert.ok(Array.isArray(res.body?.data), 'data 应为数组');
  assert.ok((res.body?.meta?.total ?? 0) >= 3, '应至少包含 3 件 seed 作品');
  const slugs = res.body.data.map((p: { slug: string }) => p.slug);
  assert.ok(slugs.includes('Aur9raFx'), 'PUBLIC ACTIVE 作品应在列表中');
  assert.ok(!slugs.includes('PuLse7Kd'), 'UNLISTED 作品不应在广场列表');
  assert.ok(!slugs.includes(qaPrivSlug), 'PRIVATE 作品不应在广场列表');
});

test('B16 POST /api/projects（登录，外链最小 payload + 脏 authorId）→ 201，作者归会话', async () => {
  const dirtyId = 'dirty-author-id-should-be-overridden';
  const res = await api('/api/projects', {
    method: 'POST',
    jar: demoJar,
    body: JSON.stringify({
      title: 'QA 外链作品',
      externalUrl: 'https://example.com/qa-external',
      authorId: dirtyId,
    }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body?.ok, true);
  const slug = res.body?.data?.slug;
  assert.ok(typeof slug === 'string' && slug.length === 8, '应返回 8 位 slug');

  const detail = await api(`/api/projects/${slug}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body?.data?.authorId, demoUserId, 'authorId 必须来自会话而非请求体');
  assert.notEqual(detail.body?.data?.authorId, dirtyId, '脏 authorId 应被覆盖');
  assert.equal(detail.body?.data?.authorName, 'demo', '作者名归属会话用户（无 alias 时为用户名）');
  assert.equal(detail.body?.data?.externalUrl, 'https://example.com/qa-external');

  // 收尾：清理该测试作品（作为作者）
  const del = await api(`/api/projects/${slug}`, { method: 'DELETE', jar: demoJar });
  assert.equal(del.status, 200);
});

test('B17 作者（demo）DELETE 自己的作品 → 200 且状态 ARCHIVED', async () => {
  const res = await api('/api/projects/Aur9raFx', { method: 'DELETE', jar: demoJar });
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.data?.status, 'ARCHIVED');
  assert.ok(res.body?.data?.purgeAt, '应带 purgeAt');
});

test('B18 作者 DELETE 后 renew 复活 → status ACTIVE 且 archivedAt 清空', async () => {
  const res = await api('/api/projects/Aur9raFx/renew', {
    method: 'POST',
    jar: demoJar,
    body: JSON.stringify({ ttlDays: 30 }),
  });
  assert.equal(res.status, 200);
  // renew 接口返回缩减 DTO（slug/status/ttlDays/expireAt，契约不含 archivedAt），
  // 复活语义（archivedAt 清空）改由详情端点验证（详情返回完整 ProjectDTO）。
  assert.equal(res.body?.data?.status, 'ACTIVE');
  const detail = await api('/api/projects/Aur9raFx');
  assert.equal(detail.status, 200);
  assert.equal(detail.body?.data?.archivedAt, null, '复活后 archivedAt 应为 null');
});

test('B19 ADMIN DELETE Aur9raFx → 200；ADMIN renew → 200 复活', async () => {
  const del = await api('/api/projects/Aur9raFx', { method: 'DELETE', jar: adminJar });
  assert.equal(del.status, 200);
  assert.equal(del.body?.data?.status, 'ARCHIVED');

  const renew = await api('/api/projects/Aur9raFx/renew', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ ttlDays: 90 }),
  });
  assert.equal(renew.status, 200);
  assert.equal(renew.body?.data?.status, 'ACTIVE');
});

/* ============================================================================
   C —— 前端引导
   ========================================================================== */

test('C1 未登录 GET /new → 登录引导卡（登录后即可发布作品 + /login?next=/new）', async () => {
  const { status, text } = await page('/new');
  assert.equal(status, 200);
  assert.match(text, /登录后即可发布作品/);
  assert.match(text, /发布前先登录/);
  assert.match(text, /login\?next=\/new/);
  assert.doesNotMatch(text, /上传方式/);
});

test('C2 已登录 GET /new → 发布向导（上传模式 tabs），无引导卡', async () => {
  const { status, text } = await page('/new', demoJar);
  assert.equal(status, 200);
  assert.match(text, /上传方式/);
  assert.match(text, /ZIP 压缩包/);
  assert.match(text, /单个 HTML/);
  assert.match(text, /外部链接/);
  assert.doesNotMatch(text, /登录后即可发布作品/);
});

test('C3 Nav：首页 HTML 含 href="/rank"（桌面 + 抽屉均渲染）', async () => {
  const { text } = await page('/');
  assert.match(text, /href="\/rank"/);
  // 排行榜应可点（非 disabled）
  const linkSegment = text.match(/<a[^>]*href="\/rank"[^>]*>/)?.[0] ?? '';
  assert.ok(linkSegment.length > 0, '存在 /rank 链接');
  assert.doesNotMatch(linkSegment, /aria-disabled/);
  assert.ok(text.includes('排行榜'), '导航含排行榜文案');
});

test('C4 未登录 GET /_status/{归档slug} → 200 已归档、无操作按钮（rewrite 生效）', async () => {
  // 先制造归档态
  await api('/api/projects/Aur9raFx', { method: 'DELETE', jar: adminJar });
  const { status, text } = await page('/_status/Aur9raFx');
  assert.equal(status, 200, 'rewrite /_status/:slug → /status/:slug 应生效');
  assert.match(text, /已归档/);
  assert.doesNotMatch(text, /恢复上线/);
  assert.doesNotMatch(text, /下线作品/);
});

test('C5 非作者（alice）GET /_status/{归档slug} → 无操作按钮', async () => {
  const { status, text } = await page('/_status/Aur9raFx', aliceJar);
  assert.equal(status, 200);
  assert.doesNotMatch(text, /恢复上线/);
  assert.doesNotMatch(text, /下线作品/);
});

test('C6 作者（demo）GET /_status/{归档slug} → 有恢复按钮', async () => {
  const { status, text } = await page('/_status/Aur9raFx', demoJar);
  assert.equal(status, 200);
  assert.match(text, /恢复上线/);
  assert.match(text, /还剩/);
  // 复活回去，避免影响 D 阶段
  const renew = await api('/api/projects/Aur9raFx/renew', {
    method: 'POST',
    jar: demoJar,
    body: JSON.stringify({ ttlDays: 90 }),
  });
  assert.equal(renew.status, 200);
  assert.equal(renew.body?.data?.status, 'ACTIVE');
});

/* ============================================================================
   D —— 排行榜 /rank
   ========================================================================== */

test('D1 造票：Aur9raFx=3、NebuLa42=2、UNLISTED PuLse7Kd=1、P2RankA/B=1；PRIVATE/ARCHIVED 置 voteCount', async () => {
  const ids = new Map<string, string>();
  // 夹具修复：ids 需收录 qaPrivSlug / qaArchSlug，否则下方 stats.update(projectId=undefined) 会抛错
  for (const slug of ['Aur9raFx', 'NebuLa42', 'PuLse7Kd', p2aSlug, p2bSlug, qaPrivSlug, qaArchSlug]) {
    const row = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
    assert.ok(row, `${slug} 应存在`);
    ids.set(slug, row!.id);
  }

  // Aur9raFx 3 票
  for (const u of ['r1', 'r2', 'r3']) {
    const jar = new CookieJar();
    await login(jar, u, 'pw');
    const res = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: ids.get('Aur9raFx') }) });
    assert.equal(res.status, 200, `${u} 投票应成功`);
  }
  // NebuLa42 2 票
  for (const u of ['r4', 'r5']) {
    const jar = new CookieJar();
    await login(jar, u, 'pw');
    const res = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: ids.get('NebuLa42') }) });
    assert.equal(res.status, 200);
  }
  // UNLISTED 1 票（可投，但不应上榜）
  {
    const jar = new CookieJar();
    await login(jar, 'r6', 'pw');
    const res = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: ids.get('PuLse7Kd') }) });
    assert.equal(res.status, 200, 'UNLISTED 可投');
  }
  // P2RankA / P2RankB 各 1 票（直接更新 stats，票数相同按 createdAt desc → 甲在乙前）
  for (const slug of [p2aSlug, p2bSlug]) {
    await prisma.projectStats.update({ where: { projectId: ids.get(slug)! }, data: { voteCount: 1 } });
  }
  // PRIVATE / ARCHIVED 置 voteCount>0（验证榜单排除）
  for (const slug of [qaPrivSlug, qaArchSlug]) {
    await prisma.projectStats.update({ where: { projectId: ids.get(slug)! }, data: { voteCount: 7 } });
  }

  const aur = await prisma.projectStats.findUnique({ where: { projectId: ids.get('Aur9raFx')! } });
  const neb = await prisma.projectStats.findUnique({ where: { projectId: ids.get('NebuLa42')! } });
  assert.equal(aur?.voteCount, 3);
  assert.equal(neb?.voteCount, 2);
});

test('D2 GET /rank → 200，podium + medal 渲染，副文案含累计票数', async () => {
  const { status, text } = await page('/rank');
  assert.equal(status, 200);
  assert.match(text, /排行榜/);
  assert.match(text, /实时更新/);
  assert.match(text, /件上榜作品/);
  assert.match(text, /累计/);
  assert.match(text, /票/);
  // 奖牌三色
  assert.match(text, /medal--gold/);
  assert.match(text, /medal--silver/);
  assert.match(text, /medal--bronze/);
  // 领奖台 + 榜单容器
  assert.match(text, /podium/);
  assert.match(text, /ranklist/);
});

test('D3 podium 视觉顺序 2/1/3，且票数最多者持 gold', async () => {
  const { text } = await page('/rank');
  const i2 = text.indexOf('podium-item--2');
  const i1 = text.indexOf('podium-item--1');
  const i3 = text.indexOf('podium-item--3');
  assert.ok(i2 !== -1 && i1 !== -1 && i3 !== -1, '应渲染 2/1/3 三个领奖台位');
  assert.ok(i2 < i1 && i1 < i3, 'DOM 顺序应为 2 → 1 → 3（2/1/3 布局）');

  // gold 块（第 2 个 podium-item 起，到 bronze 前）应包含 Aur9raFx（3 票）
  const goldBlock = text.slice(i1, i3);
  assert.match(goldBlock, /Aurora Field 极光粒子场/);
  assert.match(goldBlock, /3/);
  assert.match(goldBlock, /票/);
  // silver 块（第 1 个 podium-item）应包含 NebuLa42（2 票）
  const silverBlock = text.slice(i2, i1);
  assert.match(silverBlock, /Nebula 一页式落地页/);
  assert.match(silverBlock, /2/);
  assert.match(silverBlock, /票/);
  // ranklist 第 4 名起
  const listBlock = text.slice(i3);
  assert.match(listBlock, /ranklist/);
});

test('D4 榜上无 UNLISTED / PRIVATE / ARCHIVED', async () => {
  const { text } = await page('/rank');
  assert.doesNotMatch(text, /PuLse7Kd/);
  assert.doesNotMatch(text, /QaPrivP2/);
  assert.doesNotMatch(text, /QaArchP2/);
  assert.doesNotMatch(text, /\[QA\]/);
});

test('D5 榜单项点击目标指向 /w/[slug]', async () => {
  const { text } = await page('/rank');
  assert.ok(text.includes(`href="${SITE}/w/Aur9raFx"`), '第 1 名应链向详情页');
  assert.ok(text.includes(`href="${SITE}/w/NebuLa42"`), '第 2 名应链向详情页');
});

test('D6 清空票数 → /rank 空态「还没有作品获得投票」', async () => {
  await prisma.vote.deleteMany({});
  await prisma.projectStats.updateMany({ data: { voteCount: 0 } });

  const { status, text } = await page('/rank');
  assert.equal(status, 200);
  assert.match(text, /还没有作品获得投票/);
  assert.match(text, /回到作品广场/);
  assert.doesNotMatch(text, /medal--gold/);
  assert.doesNotMatch(text, /ranklist-row/);
});
