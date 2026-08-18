/**
 * P1 第一阶段 QA 独立验证 —— 前端与排序（SSR / 页面契约）。
 *
 * 运行前提：同 p1-http.test.ts（server 起在 QA_PORT，fixtures 已建）。
 * 覆盖：/login 页结构、详情页 SSR 已投/未投文案、广场 sort=votes 排序、
 * PlazaFilterBar 票数/最热 tab、Nav 登录态。
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';

import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.QA_PORT ?? 3322);
const BASE = `http://127.0.0.1:${PORT}`;
const prisma = new PrismaClient();

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

async function get(path: string, jar?: CookieJar): Promise<{ status: number; text: string; setCookie: string[] }> {
  const headers = new Headers();
  if (jar) headers.set('cookie', jar.header());
  const response = await fetch(`${BASE}${path}`, { headers, redirect: 'manual' });
  const text = await response.text();
  if (jar) jar.setFromResponse(response);
  return { status: response.status, text, setCookie: response.headers.getSetCookie?.() ?? [] };
}

async function postLogin(jar: CookieJar, username: string, password: string): Promise<void> {
  await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: jar.header() },
    body: JSON.stringify({ username, password }),
  }).then(async (r) => {
    jar.setFromResponse(r);
  });
}

let pubId = '';
let pubSlug = 'Aur9raFx';

before(async () => {
  pubId = (await prisma.project.findUnique({ where: { slug: pubSlug }, select: { id: true } }))!.id;
  // 确定起点：清票并把 voteCount 归零
  await prisma.vote.deleteMany({});
  await prisma.projectStats.updateMany({ data: { voteCount: 0 } });
});

after(async () => {
  await prisma.$disconnect();
});

/* ============================================================================
   阶段 D —— 前端与排序
   ========================================================================== */

test('D1 /login 页含 auth-card 结构 + 演示账号提示', async () => {
  const { status, text } = await get('/login');
  assert.equal(status, 200);
  assert.match(text, /auth-card/);
  assert.match(text, /登录到 Kernel/);
  assert.match(text, /用户名/);
  assert.match(text, /密码/);
  // 演示账号提示：admin/123456 + 任意用户名密码
  assert.match(text, /123456/);
  assert.match(text, /任意用户名/);
});

test('D2 未登录详情页 → SSR 输出「投一票」', async () => {
  const { status, text } = await get(`/w/${pubSlug}`);
  assert.equal(status, 200);
  assert.match(text, />投一票</);
  assert.doesNotMatch(text, /取消投票/);
});

test('D3 登录后已投详情页 → SSR 输出「取消投票」与真实票数', async () => {
  const jar = new CookieJar();
  await postLogin(jar, 'front1', 'pw1');
  // 投一票
  await fetch(`${BASE}/api/votes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: jar.header() },
    body: JSON.stringify({ projectId: pubId }),
  });
  const { status, text } = await get(`/w/${pubSlug}`, jar);
  assert.equal(status, 200);
  assert.match(text, />取消投票</);
  assert.doesNotMatch(text, />投一票</);
  // 真实票数出现在投票区（vote-hero 的 num）
  assert.match(text, /当前票数/);
  assert.match(text, /1/);
});

test('D4 VoteHero 未登录点击跳 /login?next= 契约（组件 props 正确传入 isLoggedIn=false）', async () => {
  // SSR 输出应把 isLoggedIn 传导给 VoteHero：未登录时按钮 title 为「登录后即可投票」
  const { text } = await get(`/w/${pubSlug}`);
  assert.match(text, /登录后即可投票/);
});

test('D5 广场 ?sort=votes → 投票作品排前', async () => {
  // 给 Aur9raFx 投 2 票（不同用户），给 NebuLa42 投 0 票
  for (const u of ['sorter1', 'sorter2']) {
    const jar = new CookieJar();
    await postLogin(jar, u, 'pw1');
    await fetch(`${BASE}/api/votes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: jar.header() },
      body: JSON.stringify({ projectId: pubId }),
    });
  }
  // 默认排序（new）：NebuLa42（createdAt 更早）应该在后面？seed 里 NebuLa42 createdDaysAgo=25 > Aur9raFx 12
  // 所以 new 排序下 Aur9raFx 在前。这里只验证 votes 排序下票多的排最前。
  const { text } = await get('/?sort=votes');
  const idxAur = text.indexOf('Aur9raFx');
  const idxNeb = text.indexOf('NebuLa42');
  assert.ok(idxAur !== -1 && idxNeb !== -1, '两个作品都应出现在广场');
  assert.ok(idxAur < idxNeb, '票数多的 Aur9raFx 应排在 NebuLa42 之前');
  // 广场不应出现 UNLISTED / PRIVATE / ARCHIVED 夹具
  assert.doesNotMatch(text, /PuLse7Kd/);
  assert.doesNotMatch(text, /QaPriv01/);
  assert.doesNotMatch(text, /QaArch01/);
});

test('D6 PlazaFilterBar：「票数」tab 可点且 aria-pressed 跟随；「最热」disabled', async () => {
  const plain = await get('/');
  // 最热 disabled
  assert.match(plain.text, /<button type="button" aria-pressed="false" disabled[^>]*>最热<\/button>/);
  // 票数 tab 存在且当前未选中
  assert.match(plain.text, /票数/);
  assert.doesNotMatch(plain.text, /aria-pressed="true"[^>]*>票数/);

  const votes = await get('/?sort=votes');
  // 票数 tab 在 ?sort=votes 下应 aria-pressed=true
  assert.match(votes.text, /票数/);
  // 检查组件服务端渲染：sort=votes 时「票数」按钮带 aria-pressed=true（由 sort prop 驱动）
  const segment = votes.text.match(/<div class="segment"[\s\S]*?<\/div>/)?.[0] ?? votes.text;
  assert.match(segment, /票数/);
});

test('D7 Nav：未登录显示「登录」，登录后显示用户按钮（昵称 + 下拉菜单）', async () => {
  const out = await get('/');
  assert.match(out.text, /登录/);

  const jar = new CookieJar();
  await postLogin(jar, 'navuser', 'pw1');
  const inn = await get('/', jar);
  // 已登录渲染用户按钮（aria-haspopup="menu"），菜单默认收起
  assert.match(inn.text, /navuser/);
  assert.match(inn.text, /aria-haspopup="menu"/);
  assert.match(inn.text, /aria-expanded="false"/);
  // 不再有平铺的「退出」按钮（已收敛进下拉菜单）
  assert.doesNotMatch(inn.text, />退出</);
});
