/**
 * P3.5 我的后台 —— QA 独立验证（QA Engineer Edward 编写视角，与实现同步对齐新契约）。
 *
 * 覆盖（以 docs/P3-我的后台设计.md 已拍板规则为准）：
 *   B 收藏 API（HTTP 层，与 P3 完全一致）：未登录 401；toggle 幂等翻转；
 *     PRIVATE slug → 404（不泄漏存在性）；不存在 → 404；GET /api/favorites/me。
 *   C dashboard ?page= 驱动（HTTP/SSR 层）：未登录 307→/login?next=/dashboard；登录 demo：
 *     ①默认 overview（欢迎头 + 4 KPI + 存储面板 + 最近作品 3 seed + 操作按钮 + 侧栏 5+2）
 *     ②?tab=joined→overview 兼容 ③?tab=favorites→favorites ④非法回落 overview
 *     ⑤4 KPI 与 DB 实查一致（作品数/累计票数/总浏览/参与活动数）+ 存储面板口径。
 *   D 前端契约：侧栏 .admin-shell/.dash-side__item + ?page= 链接；空态三处。
 *   E 改密码（HTTP 层）：无 hash 用户设密码 → 登录需真密码；错旧密码 400 OLD_PASSWORD_WRONG；
 *     弱密码 400 PASSWORD_WEAK；admin 403；AuditLog 落 auth.user.password-changed。
 *   F 我的投票双栏（SSR）：我投出的含作废徽章 / 我收到的空态 / 全站·全站赞徽章。
 *
 * 运行前提：
 *   1) `npm run db:reset`（seed demo 收藏 2 条 + admin + 3 demo 作品 + camp-demo1 + 风控票）
 *   2) `next build` + `next start -p <QA_PORT>`（SITE_URL=http://127.0.0.1:<QA_PORT>）
 *   3) QA_PORT=3322 SITE_URL=... node --require ./tests/qa/qa-register.cjs
 *      --import tsx --test tests/qa/p3-dashboard-verify.test.ts
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';

import { PrismaClient } from '@prisma/client';

import { formatBytes, formatCount } from '../../src/lib/format';

const PORT = Number(process.env.QA_PORT ?? 3322);
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

async function api(
  path: string,
  init: RequestInit & { jar?: CookieJar } = {},
): Promise<{ status: number; body: any; setCookie: string[] }> {
  const { jar, ...rest } = init;
  const headers = new Headers(rest.headers ?? {});
  if (jar) headers.set('cookie', jar.header());
  if (rest.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${BASE}${path}`, { ...rest, headers, redirect: 'manual' });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (jar) jar.setFromResponse(response);
  return { status: response.status, body, setCookie };
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

let demoJar: CookieJar;
let auroraId = '';
let nebulaId = '';

before(async () => {
  // 登录 demo（seed 作者 + 收藏者；无 hash → 任意密码可登录）
  demoJar = new CookieJar();
  const status = await login(demoJar, 'demo', 'pw1');
  assert.equal(status, 200, 'demo 登录应成功');

  const aurora = await prisma.project.findUnique({ where: { slug: 'Aur9raFx' }, select: { id: true } });
  const nebula = await prisma.project.findUnique({ where: { slug: 'NebuLa42' }, select: { id: true } });
  assert.ok(aurora && nebula, 'seed 作品缺失');
  auroraId = aurora.id;
  nebulaId = nebula.id;
});

after(async () => {
  await prisma.$disconnect();
});

/* ============================================================================
   B 收藏 API（HTTP 层，P3 行为不丢）
   ========================================================================== */

test('B1 未登录 POST /api/projects/Aur9raFx/favorite → 401 NOT_LOGGED_IN', async () => {
  const res = await api('/api/projects/Aur9raFx/favorite', { method: 'POST' });
  assert.equal(res.status, 401);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, 'NOT_LOGGED_IN');
});

test('B2 未收藏作品 toggle → true；再点 → false（幂等翻转）', async () => {
  // PuLse7Kd 在 seed 中未被 demo 收藏 → 起点未收藏
  const first = await api('/api/projects/PuLse7Kd/favorite', { method: 'POST', jar: demoJar });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.data.favorited, true, '未收藏 → 第一次 toggle 应为 true');

  const second = await api('/api/projects/PuLse7Kd/favorite', { method: 'POST', jar: demoJar });
  assert.equal(second.status, 200);
  assert.equal(second.body.data.favorited, false, '已收藏 → 第二次 toggle 应为 false');

  // 收尾：恢复未收藏
  const third = await api('/api/projects/PuLse7Kd/favorite', { method: 'POST', jar: demoJar });
  assert.equal(third.body.data.favorited, true);
  await api('/api/projects/PuLse7Kd/favorite', { method: 'POST', jar: demoJar });
});

test('B3 已收藏作品 toggle → false；再点 → true（反向幂等）', async () => {
  // Aur9raFx 在 seed 中已被 demo 收藏 → 起点已收藏
  const first = await api('/api/projects/Aur9raFx/favorite', { method: 'POST', jar: demoJar });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.favorited, false, '已收藏 → 第一次 toggle 应为 false');

  const second = await api('/api/projects/Aur9raFx/favorite', { method: 'POST', jar: demoJar });
  assert.equal(second.body.data.favorited, true, '未收藏 → 第二次 toggle 应为 true（恢复）');
});

test('B4 不存在的 slug → 404 NOT_FOUND', async () => {
  const res = await api('/api/projects/qaGhostSlug888/favorite', { method: 'POST', jar: demoJar });
  assert.equal(res.status, 404);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('B5 PRIVATE 作品 slug → 404 NOT_FOUND（不泄漏存在性）', async () => {
  // DB 直插一条 PRIVATE 夹具，验证与不存在同响应
  const src = await prisma.project.findUniqueOrThrow({ where: { slug: 'Aur9raFx' } });
  const { id: _id, slug: _s, createdAt: _c, updatedAt: _u, ...rest } = src as any;
  await prisma.project.deleteMany({ where: { slug: 'qaFavPrivP3' } });
  await prisma.project.create({
    data: { ...rest, slug: 'qaFavPrivP3', title: '[QA] P3 PRIVATE 夹具', visibility: 'PRIVATE', status: 'ACTIVE' },
    select: { id: true },
  });
  try {
    const res = await api('/api/projects/qaFavPrivP3/favorite', { method: 'POST', jar: demoJar });
    assert.equal(res.status, 404);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  } finally {
    await prisma.project.deleteMany({ where: { slug: 'qaFavPrivP3' } });
  }
});

test('B6 GET /api/favorites/me → 返回 projectId 列表（含 seed 2 条）', async () => {
  const res = await api('/api/favorites/me', { jar: demoJar });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const ids = (res.body.data as Array<{ projectId: string; createdAt: string }>).map((item) => item.projectId);
  assert.ok(ids.includes(auroraId), '应包含 Aur9raFx');
  assert.ok(ids.includes(nebulaId), '应包含 NebuLa42');
  // createdAt desc
  const times = (res.body.data as Array<{ createdAt: string }>).map((item) => new Date(item.createdAt).getTime());
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(times[i - 1] >= times[i], 'createdAt 应倒序');
  }
});

test('B7 GET /api/favorites/me 未登录 → 401', async () => {
  const res = await api('/api/favorites/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'NOT_LOGGED_IN');
});

/* ============================================================================
   C dashboard ?page= 驱动（HTTP/SSR 层）
   ========================================================================== */

test('C1 未登录 GET /dashboard → 307 /login?next=/dashboard', async () => {
  const res = await page('/dashboard');
  assert.equal(res.status, 307);
  assert.match(res.location ?? '', /\/login\?next=\/dashboard/);
});

test('C2 登录 demo /dashboard（默认 overview）：欢迎头 + 侧栏 + 最近作品 + 存储面板 + 操作', async () => {
  const res = await page('/dashboard', demoJar);
  assert.equal(res.status, 200);
  // 欢迎头 + 副文案
  assert.match(res.text, /你好，/);
  assert.match(res.text, /这是你的个人工作台/);
  // 侧栏「我的」5 项 + 「快捷」2 项
  for (const label of ['概览', '我的作品', '我的投票', '账户设置', '收藏', '发布新作品', '浏览作品广场']) {
    assert.match(res.text, new RegExp(label), `侧栏应含「${label}」`);
  }
  // 最近作品 3 件（createdAt desc：PuLse7Kd → Aurora → Nebula）
  assert.match(res.text, /Aurora Field 极光粒子场/);
  assert.match(res.text, /Nebula 一页式落地页/);
  assert.match(res.text, /Pulse 部署脉搏仪表盘/);
  const pulseIdx = res.text.indexOf('Pulse 部署脉搏仪表盘');
  const auroraIdx = res.text.indexOf('Aurora Field 极光粒子场');
  const nebulaIdx = res.text.indexOf('Nebula 一页式落地页');
  assert.ok(pulseIdx >= 0 && auroraIdx >= 0 && nebulaIdx >= 0, '三件作品都应出现');
  assert.ok(pulseIdx < auroraIdx, 'PuLse7Kd（3 天前）应排在 Aurora（12 天前）之前');
  assert.ok(auroraIdx < nebulaIdx, 'Aurora（12 天前）应排在 Nebula（25 天前）之前');
  // 最近作品表列 + 操作（ProjectActions 续期）
  assert.match(res.text, /续期/);
  // 存储面板（免费版 5 GB + 已用/配额；React 文本节点间会插入 <!-- -->，用宽松匹配）
  assert.match(res.text, /存储空间/);
  assert.match(res.text, /免费版[\s\S]{0,20}5\.00 GB/);
  assert.match(res.text, /已用/);
  assert.match(res.text, /配额/);
});

test('C3 老链接 ?tab=joined → 兼容到 overview（欢迎头 + 参与活动 KPI）', async () => {
  const res = await page('/dashboard?tab=joined', demoJar);
  assert.equal(res.status, 200);
  assert.match(res.text, /你好，/);
  assert.match(res.text, /存储空间/);
  // 参与活动数 KPI foot（Q8 纯展示）
  assert.match(res.text, /我报名的活动数/);
});

test('C4 老链接 ?tab=favorites → favorites：Aur9raFx + NebuLa42', async () => {
  const res = await page('/dashboard?tab=favorites', demoJar);
  assert.equal(res.status, 200);
  assert.match(res.text, /Aurora Field 极光粒子场/);
  assert.match(res.text, /Nebula 一页式落地页/);
});

test('C5 非法 tab（?tab=xx）→ 回落 overview（欢迎头 + 存储面板）', async () => {
  const res = await page('/dashboard?tab=xx', demoJar);
  assert.equal(res.status, 200);
  assert.match(res.text, /你好，/);
  assert.match(res.text, /存储空间/);
});

test('C6 4 张 KPI 卡数值与 DB 实查一致 + 存储面板 SUM/5GB 口径', async () => {
  const demoUser = await prisma.user.findUniqueOrThrow({ where: { username: 'demo' } });
  // 我的作品 = COUNT(authorId)（含回收站/已清除）
  const projectCount = await prisma.project.count({ where: { authorId: demoUser.id } });
  // 累计票数/浏览 = SUM(ProjectStats) over 作者全部作品
  const agg = await prisma.projectStats.aggregate({
    where: { project: { is: { authorId: demoUser.id } } },
    _sum: { voteCount: true, viewCount: true },
  });
  // 参与活动数 = groupBy(campaignId) 行数（去重活动）
  const joinedRows = await prisma.projectCampaign.groupBy({
    by: ['campaignId'],
    where: { status: 'joined', project: { authorId: demoUser.id } },
  });
  // 已用存储 = SUM(sizeBytes)
  const sizeAgg = await prisma.project.aggregate({
    where: { authorId: demoUser.id },
    _sum: { sizeBytes: true },
  });
  const usedBytes = sizeAgg._sum?.sizeBytes ?? 0;

  const res = await page('/dashboard', demoJar);
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(`>${formatCount(projectCount)}<`), `我的作品卡应=${formatCount(projectCount)}`);
  assert.match(
    res.text,
    new RegExp(`>${formatCount(agg._sum?.voteCount ?? 0)}<`),
    `累计票数应=${formatCount(agg._sum?.voteCount ?? 0)}`,
  );
  assert.match(
    res.text,
    new RegExp(`>${formatCount(agg._sum?.viewCount ?? 0)}<`),
    `总浏览应=${formatCount(agg._sum?.viewCount ?? 0)}`,
  );
  assert.match(res.text, new RegExp(`>${formatCount(joinedRows.length)}<`), `参与活动数应=${joinedRows.length}`);
  // 存储面板：已用 formatBytes(SUM) 出现在页面上，且展示「免费版 5 GB」
  assert.match(res.text, new RegExp(formatBytes(usedBytes).replace(/\./g, '\\.')), `已用应=${formatBytes(usedBytes)}`);
  assert.match(res.text, /免费版[\s\S]{0,20}5\.00 GB/);
});

/* ============================================================================
   D 前端契约（SSR 抓页面 + 源码静态）
   ========================================================================== */

test('D1 详情页 /w/Aur9raFx：FavoriteButton 与「投一票」并列（SSR 输出）', async () => {
  const res = await page('/w/Aur9raFx', demoJar);
  assert.equal(res.status, 200);
  // demo 已投票（seed 风控票含 demo→Aur9raFx），按钮文案为「取消投票」；断言投票区存在即可
  assert.match(res.text, /vote-hero-stack/, '投票与收藏应在同一操作区');
  assert.match(res.text, /当前票数/);
  // FavoriteButton inline 与已收藏态（demo 已收藏 Aur9raFx）
  assert.match(res.text, /fav-inline/);
  assert.match(res.text, /已收藏/);
});

test('D2 广场 / SSR：卡片右上角 hover 星标（.fav-overlay）存在', async () => {
  const res = await page('/', demoJar);
  assert.equal(res.status, 200);
  // (feed) 路由有 loading.tsx → 首屏 HTML 是 loading 骨架，真实内容经 RSC flight 流式下发；
  // 断言 flight payload 中的 FavoriteButton overlay 契约（variant=overlay + 已收藏态）
  assert.match(res.text, /variant[^,]{0,24}overlay/, '广场卡片应渲染 overlay 收藏星标（flight payload）');
  assert.match(res.text, /initialFavorited[^,]{0,12}true/, 'seed 收藏的作品应带已收藏态');
});

test('D3 Nav：href=/dashboard 非 disabled（源码静态 + SSR）', async () => {
  const navSrc = await (await import('node:fs')).promises.readFile('src/components/ui/Nav.tsx', 'utf8');
  assert.match(navSrc, /href: '\/dashboard'/);
  assert.doesNotMatch(navSrc, /href: '\/dashboard', label: '我的作品', disabled/);
  const res = await page('/', demoJar);
  assert.match(res.text, /href="\/dashboard"/);
  assert.match(res.text, /我的作品/);
});

test('D4 /dashboard 含侧栏 .dash-side__item + ?page= 链接（SSR）', async () => {
  const res = await page('/dashboard', demoJar);
  assert.equal(res.status, 200);
  assert.match(res.text, /class="[^"]*admin-shell/);
  assert.match(res.text, /class="[^"]*dash-side__item/);
  assert.match(res.text, /href="\/dashboard\?page=myprojects"/);
  assert.match(res.text, /href="\/dashboard\?page=myvotes"/);
  assert.match(res.text, /href="\/dashboard\?page=settings"/);
  assert.match(res.text, /href="\/dashboard\?page=favorites"/);
});

test('D5 空态：新用户 overview / myprojects / favorites 三处', async () => {
  const jar = new CookieJar();
  const status = await login(jar, 'qa-p3-empty', 'pw1');
  assert.equal(status, 200);

  const overview = await page('/dashboard', jar);
  assert.match(overview.text, /你还没有作品/);
  assert.match(overview.text, /发布作品/);

  const mine = await page('/dashboard?page=myprojects', jar);
  assert.match(mine.text, /你还没有作品/);
  assert.match(mine.text, /＋ 新作品/, '空态时 Panel head 的「＋ 新作品」按钮仍应展示');

  const fav = await page('/dashboard?page=favorites', jar);
  assert.match(fav.text, /还没有收藏/);
  assert.match(fav.text, /逛逛广场/);
});

/* ============================================================================
   E 改密码（HTTP 层，P3.5 §1.6 / §1.7）
   ========================================================================== */

test('E1 无 hash 用户设密码 → 登录需真密码；错旧密码/弱密码分支；AuditLog', async () => {
  const jar = new CookieJar();
  const status = await login(jar, 'qa-pw-user', 'any-pw');
  assert.equal(status, 200, '无 hash 用户任意密码可登录');

  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'qa-pw-user' } });
  assert.equal(user.passwordHash, null, '登录不应写入 passwordHash');

  // ① 无 hash：当前密码可空 + 新密码 ≥6 → 200
  const setRes = await api('/api/auth/password', {
    method: 'POST',
    jar,
    body: JSON.stringify({ currentPassword: '', newPassword: 'abc123' }),
  });
  assert.equal(setRes.status, 200);
  assert.equal(setRes.body.ok, true);
  assert.equal(setRes.body.data.changed, true);

  // ② 已落库 + AuditLog
  const after = await prisma.user.findUniqueOrThrow({ where: { username: 'qa-pw-user' } });
  assert.ok(after.passwordHash && after.passwordHash.startsWith('scrypt$'), 'passwordHash 应为 scrypt 派生串');
  const audit = await prisma.auditLog.findFirst({
    where: { actorId: user.id, action: 'auth.user.password-changed', targetId: user.id },
  });
  assert.ok(audit, '应写入 auth.user.password-changed 审计');

  // ③ 登录校验改为需真密码：错密码 400 PASSWORD_WRONG / 对密码 200
  const wrongJar = new CookieJar();
  const wrongStatus = await login(wrongJar, 'qa-pw-user', 'wrong-pw');
  assert.equal(wrongStatus, 400, '有 hash 后错密码应 400');
  const okJar = new CookieJar();
  const okStatus = await login(okJar, 'qa-pw-user', 'abc123');
  assert.equal(okStatus, 200, '有 hash 后对密码应 200');

  // ④ 弱密码 → 400 PASSWORD_WEAK
  const weakRes = await api('/api/auth/password', {
    method: 'POST',
    jar: okJar,
    body: JSON.stringify({ currentPassword: 'abc123', newPassword: '123' }),
  });
  assert.equal(weakRes.status, 400);
  assert.equal(weakRes.body.error.code, 'PASSWORD_WEAK');

  // ⑤ 当前密码错误 → 400 OLD_PASSWORD_WRONG
  const oldRes = await api('/api/auth/password', {
    method: 'POST',
    jar: okJar,
    body: JSON.stringify({ currentPassword: 'not-my-pw', newPassword: 'abcdef' }),
  });
  assert.equal(oldRes.status, 400);
  assert.equal(oldRes.body.error.code, 'OLD_PASSWORD_WRONG');

  // 收尾：清理夹具（用户 + 审计）
  await prisma.auditLog.deleteMany({ where: { actorId: user.id } });
  await prisma.user.deleteMany({ where: { username: 'qa-pw-user' } });
});

test('E2 admin 改密码：前端隐藏表单（SSR 无表单）+ API 403', async () => {
  const adminJar = new CookieJar();
  const status = await login(adminJar, 'admin', '123456');
  assert.equal(status, 200);

  const res = await page('/dashboard?page=settings', adminJar);
  assert.equal(res.status, 200);
  assert.match(res.text, /演示管理员账号密码固定为/);
  assert.doesNotMatch(res.text, /保存修改/, 'admin 不应渲染改密码表单');

  const apiRes = await api('/api/auth/password', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ currentPassword: '', newPassword: 'abc123' }),
  });
  assert.equal(apiRes.status, 403);
  assert.equal(apiRes.body.error.code, 'FORBIDDEN');
});

/* ============================================================================
   F 我的投票双栏（SSR，P3.5 §1.5）
   ========================================================================== */

test('F1 我的投票：我投出的含作废徽章 / 我收到的空态 / 全站·全站赞徽章', async () => {
  const jar = new CookieJar();
  const status = await login(jar, 'qa-votes-user', 'pw1');
  assert.equal(status, 200);

  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'qa-votes-user' } });
  const aurora = await prisma.project.findUniqueOrThrow({ where: { slug: 'Aur9raFx' } });
  const nebula = await prisma.project.findUniqueOrThrow({ where: { slug: 'NebuLa42' } });

  // 夹具：1 条有效全站票（Aurora）+ 1 条作废全站票（Nebula）—— Vote 的
  // @@unique([projectId, userId]) 保证一人一作品一票，因此用两个作品区分。
  const votes = [
    { projectId: aurora.id, userId: user.id, campaignId: null, valid: true, invalidReason: null },
    { projectId: nebula.id, userId: user.id, campaignId: null, valid: false, invalidReason: '风控作废测试' },
  ];
  await prisma.vote.deleteMany({ where: { userId: user.id } });
  await prisma.vote.createMany({ data: votes });

  try {
    const res = await page('/dashboard?page=myvotes', jar);
    assert.equal(res.status, 200);
    // 左栏标题 + 活动徽章（campaignId=null → 全站）+ 作废徽章
    assert.match(res.text, /我投出的票/);
    assert.match(res.text, /Aurora Field 极光粒子场/);
    assert.match(res.text, /Nebula 一页式落地页/);
    assert.match(res.text, /全站/);
    assert.match(res.text, /已作废/, '作废票应展示「已作废」徽章');
    // 右栏：qa-votes-user 名下无作品 → 空态
    assert.match(res.text, /我收到的票/);
    assert.match(res.text, /你的作品还没有收到票/);
  } finally {
    await prisma.vote.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { username: 'qa-votes-user' } });
  }
});
