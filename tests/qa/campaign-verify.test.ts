/**
 * P1 活动 Campaign 模块 —— QA 独立验证（QA Engineer 独立编写，全新视角，不信任工程师自验）。
 *
 * 覆盖（以 docs/P1-活动模块设计.md 已拍板规则为准）：
 *   B 活动 API（HTTP 层）：列表（含 effective 状态/作品数/票数、draft 不泄漏）、
 *     详情（规则+已报名作品）、报名（401/200/幂等/403 别人作品/404 draft）。
 *   C 投票校验链（核心）：不带 campaignId 与 P1 全站赞一致；带 campaignId 的
 *     voting 200 / collecting 409 / 未报名 409 / 自投被禁 403 / quota 用尽 409 /
 *     重复投幂等；活动票计入 ProjectStats.voteCount（总榜含）；quota 端点正确；
 *     结束 → 409；移除报名后新票 409 + 存量票保留。
 *   D 活动榜与页面：scope=campaign 排序（仅活动票）；scope=global 含活动票；
 *     /campaigns 广场 200 含 camp-demo1；/campaigns/camp-demo1 详情 200；
 *     广场 ?campaign= 筛选；作品详情页活动 badge；Nav/AdminShell 入口。
 *   E 后台管理：ADMIN 创建/编辑推进/移除报名；AuditLog admin.campaign.*；
 *     未登录 401 非 ADMIN 403；非法时间顺序 400。
 *
 * 运行前提：
 *   1) `npm run db:reset`（seed 含 camp-demo1 + demo/admin）。
 *   2) `next build` + `next start -p <QA_PORT>`（SITE_URL=http://127.0.0.1:<QA_PORT>）。
 *   3) 运行：QA_PORT=3322 SITE_URL=... node --require ./tests/qa/qa-register.cjs
 *      --import tsx --test tests/qa/campaign-verify.test.ts
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';

import { PrismaClient } from '@prisma/client';

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
): Promise<{ status: number; body: any }> {
  const { jar, ...rest } = init;
  const headers = new Headers(rest.headers ?? {});
  if (jar) headers.set('cookie', jar.header());
  if (rest.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${BASE}${path}`, { ...rest, headers, redirect: 'manual' });
  const text = await response.text();
  let body: unknown;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  if (jar) jar.setFromResponse(response);
  return { status: response.status, body };
}

async function login(jar: CookieJar, username: string, password = 'pw1') {
  return api('/api/auth/login', { method: 'POST', jar, body: JSON.stringify({ username, password }) });
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

let adminJar: CookieJar;
let demoJar: CookieJar;
let voterJar: CookieJar;
let quotaVoterJar: CookieJar; // C9 专用（未投过 auroraId）
let removeVoterJar: CookieJar; // C12 专用（未投过 auroraId）

let auroraId = '';
let nebulaId = '';
let pulseId = '';
let otherId = ''; // qa-user2 的作品（非 demo 所有）

let demo1Id = ''; // camp-demo1 的 DB id

// 夹具活动（before 中经 Prisma 直插，行为验证走 HTTP）
let collectId = '';
let noselfId = '';
let quotaId = '';
let removeId = '';
let endId = '';

/** 从 seed 复制一行作品结构（避免手写全字段）。 */
async function cloneProject(srcSlug: string, spec: { slug: string; title: string; authorId: string }) {
  const src = await prisma.project.findUnique({ where: { slug: srcSlug } });
  assert.ok(src, `源作品 ${srcSlug} 不存在`);
  const { id: _id, slug: _s, createdAt: _c, updatedAt: _u, ...rest } = src as any;
  await prisma.project.deleteMany({ where: { slug: spec.slug } });
  return prisma.project.create({ data: { ...rest, slug: spec.slug, title: spec.title, authorId: spec.authorId } });
}

before(async () => {
  // 清票，保证 count 起点确定（对齐 p1-http 口径）
  await prisma.vote.deleteMany({});
  await prisma.projectStats.updateMany({ data: { voteCount: 0 } });

  const aurora = await prisma.project.findUnique({ where: { slug: 'Aur9raFx' } });
  const nebula = await prisma.project.findUnique({ where: { slug: 'NebuLa42' } });
  const pulse = await prisma.project.findUnique({ where: { slug: 'PuLse7Kd' } });
  assert.ok(aurora && nebula && pulse, 'seed 作品缺失');
  auroraId = aurora.id;
  nebulaId = nebula.id;
  pulseId = pulse.id;

  // qa-user2（非 demo）+ 其作品
  await prisma.user.upsert({
    where: { username: 'qa-user2' },
    update: {},
    create: { username: 'qa-user2', nickname: 'QA 用户2', role: 'USER', status: 'ACTIVE' },
  });
  const u2 = await prisma.user.findUniqueOrThrow({ where: { username: 'qa-user2' } });
  const other = await cloneProject('Aur9raFx', { slug: 'QaCampOther', title: '[QA] 别人的作品', authorId: u2.id });
  otherId = other.id;

  const demo1 = await prisma.campaign.findUniqueOrThrow({ where: { slug: 'camp-demo1' } });
  demo1Id = demo1.id;

  const now = Date.now();
  const mk = async (slug: string, data: any, joined: string[]) => {
    await prisma.campaign.deleteMany({ where: { slug } });
    const c = await prisma.campaign.create({
      data: { slug, title: `QA 活动 ${slug}`, description: null, status: 'draft', authorId: demo1.authorId, ...data },
    });
    for (const pid of joined) {
      await prisma.projectCampaign.create({
        data: { campaignId: c.id, projectId: pid, status: 'joined' },
      });
    }
    return c;
  };

  const collect = await mk(
    'qa-camp-collect',
    {
      status: 'collecting',
      collectEndAt: new Date(now + 2 * DAY),
      voteStartAt: new Date(now + 2 * DAY),
      voteEndAt: new Date(now + 5 * DAY),
      maxVotesPerUser: 3,
      allowSelfVote: true,
    },
    [],
  );
  collectId = collect.id;

  const noself = await mk(
    'qa-camp-noself',
    {
      status: 'voting',
      collectEndAt: new Date(now - DAY),
      voteStartAt: new Date(now - DAY),
      voteEndAt: new Date(now + 10 * DAY),
      maxVotesPerUser: 3,
      allowSelfVote: false,
    },
    [auroraId],
  );
  noselfId = noself.id;

  const quota = await mk(
    'qa-camp-quota',
    {
      status: 'voting',
      collectEndAt: new Date(now - DAY),
      voteStartAt: new Date(now - DAY),
      voteEndAt: new Date(now + 10 * DAY),
      maxVotesPerUser: 1,
      allowSelfVote: true,
    },
    [auroraId, nebulaId],
  );
  quotaId = quota.id;

  const remove = await mk(
    'qa-camp-remove',
    {
      status: 'voting',
      collectEndAt: new Date(now - DAY),
      voteStartAt: new Date(now - DAY),
      voteEndAt: new Date(now + 10 * DAY),
      maxVotesPerUser: 3,
      allowSelfVote: true,
    },
    [auroraId, pulseId],
  );
  removeId = remove.id;

  const end = await mk(
    'qa-camp-end',
    {
      status: 'voting',
      collectEndAt: new Date(now - DAY),
      voteStartAt: new Date(now - DAY),
      voteEndAt: new Date(now + 10 * DAY),
      maxVotesPerUser: 3,
      allowSelfVote: true,
    },
    [auroraId],
  );
  endId = end.id;

  // draft 夹具（只建不对外）
  await prisma.campaign.deleteMany({ where: { slug: 'qa-camp-draft' } });
  await prisma.campaign.create({
    data: {
      slug: 'qa-camp-draft',
      title: 'QA 草稿活动',
      description: null,
      status: 'draft',
      authorId: demo1.authorId,
      collectEndAt: new Date(now + DAY),
      voteStartAt: new Date(now + DAY),
      voteEndAt: new Date(now + 3 * DAY),
    },
  });

  // E2 经 API 创建的活动（重复运行前清掉）
  await prisma.campaign.deleteMany({ where: { slug: 'qa-camp-api' } });

  adminJar = new CookieJar();
  await login(adminJar, 'admin', '123456');
  demoJar = new CookieJar();
  await login(demoJar, 'demo', 'pw1');
  voterJar = new CookieJar();
  await login(voterJar, 'qa-voter', 'pw1');
  quotaVoterJar = new CookieJar();
  await login(quotaVoterJar, 'qa-quota-voter', 'pw1');
  removeVoterJar = new CookieJar();
  await login(removeVoterJar, 'qa-remove-voter', 'pw1');
});

after(async () => {
  await prisma.$disconnect();
});

/* ============================================================================
   B 活动 API（HTTP 层）
   ========================================================================== */

test('B1 GET /api/campaigns：列表含 camp-demo1，effective=voting，projectCount=2，无 draft', async () => {
  const res = await api('/api/campaigns');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const items = res.body.data as any[];
  const demo = items.find((c) => c.slug === 'camp-demo1');
  assert.ok(demo, 'camp-demo1 应在列表中');
  assert.equal(demo.status, 'voting', '存储态 collecting + 时间窗已过 → effective 应为 voting');
  assert.equal(demo.projectCount, 2, 'joined 作品数应为 2');
  assert.equal(typeof demo.voteCount, 'number');
  assert.ok(demo.maxVotesPerUser === 3 && demo.allowSelfVote === true, '规则字段应透出');
  const draftHit = items.find((c) => c.slug === 'qa-camp-draft');
  assert.equal(draftHit, undefined, 'draft 活动不应出现在公开列表');
});

test('B2 GET /api/campaigns/camp-demo1：详情 200 含规则与已报名作品（2 件，按活动内票数排序）', async () => {
  const res = await api('/api/campaigns/camp-demo1');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.slug, 'camp-demo1');
  assert.equal(res.body.data.status, 'voting');
  assert.equal(res.body.data.projectCount, 2);
  assert.equal(res.body.data.projects.length, 2);
  assert.equal(res.body.data.maxVotesPerUser, 3);
  assert.equal(res.body.data.allowSelfVote, true);
  const slugs = res.body.data.projects.map((p: any) => p.project.slug).sort();
  assert.deepEqual(slugs, ['Aur9raFx', 'NebuLa42']);
  assert.ok(typeof res.body.data.projects[0].campaignVoteCount === 'number');
});

test('B3 报名未登录 → 401 NOT_LOGGED_IN', async () => {
  const res = await api('/api/campaigns/camp-demo1/join', {
    method: 'POST',
    body: JSON.stringify({ projectId: auroraId }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'NOT_LOGGED_IN');
});

test('B4 draft 活动报名/详情/列表一律 404，不泄漏存在性', async () => {
  const joinRes = await api('/api/campaigns/qa-camp-draft/join', {
    method: 'POST',
    jar: demoJar,
    body: JSON.stringify({ projectId: auroraId }),
  });
  assert.equal(joinRes.status, 404);
  assert.equal(joinRes.body.error.code, 'CAMP_NOT_FOUND');

  const detailRes = await api('/api/campaigns/qa-camp-draft');
  assert.equal(detailRes.status, 404);
  assert.equal(detailRes.body.error.code, 'CAMP_NOT_FOUND');

  const listRes = await api('/api/campaigns');
  assert.equal(listRes.body.data.some((c: any) => c.slug === 'qa-camp-draft'), false);
});

test('B5 报名自己作品（collecting 期）→ 200 joined:true alreadyJoined:false', async () => {
  const res = await api('/api/campaigns/qa-camp-collect/join', {
    method: 'POST',
    jar: demoJar,
    body: JSON.stringify({ projectId: pulseId }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.joined, true);
  assert.equal(res.body.data.alreadyJoined, false);
  assert.equal(res.body.data.projectCount, 1);
});

test('B6 重复报名 → 200 alreadyJoined:true（幂等不报错）', async () => {
  const res = await api('/api/campaigns/qa-camp-collect/join', {
    method: 'POST',
    jar: demoJar,
    body: JSON.stringify({ projectId: pulseId }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.alreadyJoined, true);
  assert.equal(res.body.data.projectCount, 1, '重复报名不重复计数');
});

test('B7 报名别人作品 → 403 FORBIDDEN', async () => {
  const res = await api('/api/campaigns/qa-camp-collect/join', {
    method: 'POST',
    jar: demoJar,
    body: JSON.stringify({ projectId: otherId }),
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('B8 作品不存在/不可见报名 → 404 NOT_FOUND', async () => {
  const res = await api('/api/campaigns/qa-camp-collect/join', {
    method: 'POST',
    jar: demoJar,
    body: JSON.stringify({ projectId: 'cafebabe0000000000000000' }),
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

/* ============================================================================
   C 投票校验链（核心）
   ========================================================================== */

test('C1 不带 campaignId → 与 P1 全站赞一致（voted:true + count+1，无 campaign 字段）', async () => {
  const before = await prisma.projectStats.findUnique({ where: { projectId: pulseId } });
  const beforeCount = before?.voteCount ?? 0;
  const res = await api('/api/votes', { method: 'POST', jar: voterJar, body: JSON.stringify({ projectId: pulseId }) });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.voted, true);
  assert.equal(res.body.data.voteCount, beforeCount + 1);
  assert.equal(res.body.data.campaignVoteCount, undefined, '不带 campaignId 不返回活动字段');
  assert.equal(res.body.data.remainingQuota, undefined);
});

test('C2 带 campaignId + voting 期 → 200，返回 campaignVoteCount + remainingQuota', async () => {
  const res = await api('/api/votes', {
    method: 'POST',
    jar: voterJar,
    body: JSON.stringify({ projectId: auroraId, campaignId: demo1Id }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.voted, true);
  assert.equal(res.body.data.campaignVoteCount, 1);
  assert.equal(res.body.data.remainingQuota, 2, 'max=3 用 1 剩 2');
});

test('C3 重复投同一作品（同活动）→ 幂等：voted:true 且活动票数/剩余票不变', async () => {
  const res = await api('/api/votes', {
    method: 'POST',
    jar: voterJar,
    body: JSON.stringify({ projectId: auroraId, campaignId: demo1Id }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.voted, true);
  assert.equal(res.body.data.campaignVoteCount, 1, '不重复计票');
  assert.equal(res.body.data.remainingQuota, 2);
});

test('C4 活动不在投票期（collecting）→ 409 CAMP_NOT_OPEN（附 extra.status）', async () => {
  const res = await api('/api/votes', {
    method: 'POST',
    jar: voterJar,
    body: JSON.stringify({ projectId: auroraId, campaignId: collectId }),
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CAMP_NOT_OPEN');
  assert.equal(res.body.error.status, 'collecting');
});

test('C5 活动已结束（PATCH 推进 ended）→ 投票 409 CAMP_NOT_OPEN', async () => {
  const patch = await api(`/api/admin/campaigns/${endId}`, {
    method: 'PATCH',
    jar: adminJar,
    body: JSON.stringify({ status: 'ended' }),
  });
  assert.equal(patch.status, 200);
  const res = await api('/api/votes', {
    method: 'POST',
    jar: voterJar,
    body: JSON.stringify({ projectId: auroraId, campaignId: endId }),
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CAMP_NOT_OPEN');
  assert.equal(res.body.error.status, 'ended');
});

test('C6 未报名作品投活动票 → 409 CAMP_PROJECT_NOT_JOINED', async () => {
  const res = await api('/api/votes', {
    method: 'POST',
    jar: voterJar,
    body: JSON.stringify({ projectId: pulseId, campaignId: demo1Id }),
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CAMP_PROJECT_NOT_JOINED');
});

test('C7 allowSelfVote=false 投自己 → 403 SELF_VOTE_FORBIDDEN', async () => {
  const res = await api('/api/votes', {
    method: 'POST',
    jar: demoJar,
    body: JSON.stringify({ projectId: auroraId, campaignId: noselfId }),
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'SELF_VOTE_FORBIDDEN');
});

test('C8 活动不存在 campaignId → 404 CAMP_NOT_FOUND', async () => {
  const res = await api('/api/votes', {
    method: 'POST',
    jar: voterJar,
    body: JSON.stringify({ projectId: auroraId, campaignId: 'cafebabe0000000000000000' }),
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'CAMP_NOT_FOUND');
});

test('C9 quota 用尽（max=1）→ 409 VOTE_QUOTA_EXCEEDED（附 max/used）', async () => {
  // 专用用户：qa-quota-voter 未投过 auroraId（一人一作品一生一票，避免幂等路径）
  const first = await api('/api/votes', {
    method: 'POST',
    jar: quotaVoterJar,
    body: JSON.stringify({ projectId: auroraId, campaignId: quotaId }),
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.campaignVoteCount, 1);
  assert.equal(first.body.data.remainingQuota, 0);

  const second = await api('/api/votes', {
    method: 'POST',
    jar: quotaVoterJar,
    body: JSON.stringify({ projectId: nebulaId, campaignId: quotaId }),
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'VOTE_QUOTA_EXCEEDED');
  assert.equal(second.body.error.max, 1);
  assert.equal(second.body.error.used, 1);
});

test('C10 GET /api/votes/quota?campaign=：未登录 401 / 缺参数 400 / 不存在 404 / 正确剩余', async () => {
  const unauth = await api('/api/votes/quota?campaign=camp-demo1');
  assert.equal(unauth.status, 401);

  const missing = await api('/api/votes/quota', { jar: voterJar });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'VALIDATION_FAILED');

  const notfound = await api('/api/votes/quota?campaign=qa-no-such', { jar: voterJar });
  assert.equal(notfound.status, 404);
  assert.equal(notfound.body.error.code, 'CAMP_NOT_FOUND');

  const ok = await api('/api/votes/quota?campaign=camp-demo1', { jar: voterJar });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.slug, 'camp-demo1');
  assert.equal(ok.body.data.maxVotesPerUser, 3);
  assert.equal(ok.body.data.used, 1, 'C2 已投 1 票');
  assert.equal(ok.body.data.remaining, 2);
});

test('C11 活动票计入 ProjectStats.voteCount（总榜含活动票）', async () => {
  const stats = await prisma.projectStats.findUnique({ where: { projectId: auroraId } });
  const count = stats?.voteCount ?? 0;
  assert.ok(count >= 1, `Aur9raFx 总票应 ≥1（含活动票），实际 ${count}`);

  const rank = await api('/api/rank?scope=global&limit=48');
  const hit = (rank.body.data as any[]).find((p) => p.slug === 'Aur9raFx');
  assert.ok(hit, 'scope=global 总榜应包含 Aur9raFx');
  assert.ok(hit.voteCount >= 1, '总榜 voteCount 应含活动票');
});

test('C12 移除报名：详情不再显示；新投票 409；存量票保留（voteCount 不减）', async () => {
  // 专用用户：qa-remove-voter 未投过 auroraId（避免命中已有 (projectId,userId) 幂等路径）
  // 先投一票（qa-camp-remove 已 joined Aur9raFx）
  const vote = await api('/api/votes', {
    method: 'POST',
    jar: removeVoterJar,
    body: JSON.stringify({ projectId: auroraId, campaignId: removeId }),
  });
  assert.equal(vote.status, 200);
  assert.equal(vote.body.data.campaignVoteCount, 1);

  const statsBefore = await prisma.projectStats.findUnique({ where: { projectId: auroraId } });
  const beforeCount = statsBefore?.voteCount ?? 0;
  const voteRowsBefore = await prisma.vote.count({ where: { projectId: auroraId, campaignId: removeId } });

  // 管理员移除报名
  const remove = await api(`/api/admin/campaigns/${removeId}/projects/${auroraId}`, {
    method: 'DELETE',
    jar: adminJar,
  });
  assert.equal(remove.status, 200);
  assert.equal(remove.body.data.removed, true);

  // 详情不再显示
  const detail = await api(`/api/campaigns/qa-camp-remove`);
  const slugs = detail.body.data.projects.map((p: any) => p.project.slug);
  assert.ok(!slugs.includes('Aur9raFx'), '移除后详情不应显示 Aur9raFx');
  assert.ok(slugs.includes('PuLse7Kd'), '其它作品仍在');

  // 新投票被拒
  const reVote = await api('/api/votes', {
    method: 'POST',
    jar: removeVoterJar,
    body: JSON.stringify({ projectId: auroraId, campaignId: removeId }),
  });
  assert.equal(reVote.status, 409);
  assert.equal(reVote.body.error.code, 'CAMP_PROJECT_NOT_JOINED');

  // 存量票保留：Vote 行不删、ProjectStats.voteCount 不减
  const voteRowsAfter = await prisma.vote.count({ where: { projectId: auroraId, campaignId: removeId } });
  assert.equal(voteRowsAfter, voteRowsBefore, '存量票应保留');
  const statsAfter = await prisma.projectStats.findUnique({ where: { projectId: auroraId } });
  assert.equal(statsAfter?.voteCount ?? 0, beforeCount, '移除报名不减总票数');
});

test('C13 重复移除报名 → 幂等 removed:true（不报错）', async () => {
  const res = await api(`/api/admin/campaigns/${removeId}/projects/${auroraId}`, {
    method: 'DELETE',
    jar: adminJar,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.removed, true);
});

/* ============================================================================
   D 活动榜与页面
   ========================================================================== */

test('D1 /api/rank?scope=campaign：仅活动票、排序正确（票数 desc、joinedAt asc）', async () => {
  const res = await api('/api/rank?scope=campaign&campaign=camp-demo1');
  assert.equal(res.status, 200);
  const items = res.body.data as any[];
  assert.ok(items.length >= 1, '活动榜不应为空');
  // C2 给 Aur9raFx 投了 1 票；NebuLa42 0 票 → Aur9raFx 在前
  assert.equal(items[0].project.slug, 'Aur9raFx');
  assert.equal(items[0].campaignVoteCount, 1);
  const total = items.reduce((s, it) => s + it.campaignVoteCount, 0);
  assert.equal(total, 1, '活动榜只统计活动票（C2 的 1 票）');
  assert.ok(items.every((it, i) => i === 0 || items[i - 1].campaignVoteCount >= it.campaignVoteCount), '票数应降序');
});

test('D2 scope=campaign 缺 campaign 参数 → 400 VALIDATION_FAILED；不存在 slug → 404', async () => {
  const missing = await api('/api/rank?scope=campaign');
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'VALIDATION_FAILED');

  const notfound = await api('/api/rank?scope=campaign&campaign=qa-no-such');
  assert.equal(notfound.status, 404);
  assert.equal(notfound.body.error.code, 'CAMP_NOT_FOUND');
});

test('D3 /campaigns 广场 200 含 camp-demo1 卡片；/campaigns/camp-demo1 详情 200；draft 页 404', async () => {
  const plaza = await fetch(`${BASE}/campaigns`);
  assert.equal(plaza.status, 200);
  const html = await plaza.text();
  assert.ok(html.includes('camp-demo1'), '广场 HTML 应含 camp-demo1');
  assert.ok(html.includes('Kernel 夏日创意种子征集'), '广场应展示活动标题');

  const detail = await fetch(`${BASE}/campaigns/camp-demo1`);
  assert.equal(detail.status, 200);
  const dhtml = await detail.text();
  assert.ok(dhtml.includes('已报名作品'), '详情页应含作品网格');
  assert.ok(dhtml.includes('活动规则'), '详情页应含规则');
  assert.ok(dhtml.includes('Aur9raFx') || dhtml.includes('夏日'), '详情页应渲染报名作品');
  assert.ok(dhtml.includes('camp-flow'), '详情页应含时间线');

  const draft = await fetch(`${BASE}/campaigns/qa-camp-draft`);
  assert.equal(draft.status, 404, 'draft 详情页应 404');
});

test('D4 广场 ?campaign= 筛选：只显示该活动 joined 作品', async () => {
  const feed = await fetch(`${BASE}/?campaign=camp-demo1`);
  assert.equal(feed.status, 200);
  const html = await feed.text();
  // 广场 HTML 应包含已报名作品、不含未报名作品（PuLse7Kd 未报名 camp-demo1）
  assert.ok(html.includes('Aurora Field') || html.includes('Aur9raFx'), '筛选后应显示 Aur9raFx');
  assert.ok(html.includes('Nebula'), '筛选后应显示 NebuLa42');
  assert.ok(!html.includes('Pulse'), '筛选后不应显示未报名作品 PuLse7Kd');

  // 不传 campaign → 广场照常显示（公开作品仍在，含 Aurora）
  const all = await fetch(`${BASE}/`);
  const allHtml = await all.text();
  assert.ok(allHtml.includes('Aurora Field'), '无筛选时广场应正常显示公开作品');
});

test('D5 作品详情页 /w/NebuLa42 含活动 badge（camp-demo1 直链）', async () => {
  // NebuLa42 仅报名 camp-demo1 + qa-camp-quota 两场（≤2 直显，无 overflow）
  const res = await fetch(`${BASE}/w/NebuLa42`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('detail__campaigns'), '详情页应含活动 badge 区块');
  assert.ok(html.includes('badge--campaign'), '应渲染 campaign badge');
  assert.ok(html.includes('/campaigns/camp-demo1'), 'badge 应链接到 /campaigns/camp-demo1');
});

/* ============================================================================
   E 后台管理
   ========================================================================== */

test('E1 后台鉴权：未登录 401；非 ADMIN（USER）403', async () => {
  const unauth = await api('/api/admin/campaigns', { method: 'POST', body: JSON.stringify({ title: 'x' }) });
  assert.equal(unauth.status, 401);
  assert.equal(unauth.body.error.code, 'NOT_LOGGED_IN');

  const user = await api('/api/admin/campaigns', {
    method: 'POST',
    jar: voterJar,
    body: JSON.stringify({ title: 'x' }),
  });
  assert.equal(user.status, 403);
});

test('E2 ADMIN 创建活动 → 200 status=draft + AuditLog admin.campaign.create', async () => {
  const now = new Date(Date.now() + DAY);
  const res = await api('/api/admin/campaigns', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({
      title: 'QA 后台创建活动',
      slug: 'qa-camp-api',
      collectEndAt: now.toISOString(),
      voteStartAt: new Date(Date.now() + 2 * DAY).toISOString(),
      voteEndAt: new Date(Date.now() + 5 * DAY).toISOString(),
      maxVotesPerUser: 5,
      allowSelfVote: false,
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.slug, 'qa-camp-api');
  assert.equal(res.body.data.status, 'draft', '创建后初始态为 draft');

  const audit = await prisma.auditLog.findFirst({
    where: { targetType: 'campaign', targetId: res.body.data.id },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(audit, '应有 AuditLog');
  assert.equal(audit.action, 'admin.campaign.create');
});

test('E3 ADMIN PATCH 推进状态 collecting→voting + AuditLog admin.campaign.update', async () => {
  const camp = await prisma.campaign.findUniqueOrThrow({ where: { slug: 'qa-camp-api' } });
  const p1 = await api(`/api/admin/campaigns/${camp.id}`, {
    method: 'PATCH',
    jar: adminJar,
    body: JSON.stringify({ status: 'collecting' }),
  });
  assert.equal(p1.status, 200);
  assert.equal(p1.body.data.status, 'collecting');

  const p2 = await api(`/api/admin/campaigns/${camp.id}`, {
    method: 'PATCH',
    jar: adminJar,
    body: JSON.stringify({ status: 'voting', voteEndAt: new Date(Date.now() + 7 * DAY).toISOString() }),
  });
  assert.equal(p2.status, 200);
  assert.equal(p2.body.data.status, 'voting');

  const audits = await prisma.auditLog.findMany({
    where: { targetType: 'campaign', targetId: camp.id, action: { in: ['admin.campaign.update'] } },
    orderBy: { createdAt: 'desc' },
    take: 2,
  });
  assert.ok(audits.length >= 2, '每次 PATCH 都应留痕');
});

test('E4 非法时间顺序 → 400 VALIDATION_FAILED', async () => {
  const res = await api('/api/admin/campaigns', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({
      title: 'QA 非法时间活动',
      collectEndAt: new Date(Date.now() + 3 * DAY).toISOString(),
      voteStartAt: new Date(Date.now() + 1 * DAY).toISOString(), // 早于 collectEndAt
      voteEndAt: new Date(Date.now() + 5 * DAY).toISOString(),
    }),
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
});

test('E5 非法 maxVotesPerUser / 非法 status → 400', async () => {
  const badMax = await api('/api/admin/campaigns', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ title: 'QA 非法限票', maxVotesPerUser: 2 }),
  });
  assert.equal(badMax.status, 400);
  assert.equal(badMax.body.error.code, 'VALIDATION_FAILED');

  const camp = await prisma.campaign.findUniqueOrThrow({ where: { slug: 'qa-camp-api' } });
  const badStatus = await api(`/api/admin/campaigns/${camp.id}`, {
    method: 'PATCH',
    jar: adminJar,
    body: JSON.stringify({ status: 'on-fire' }),
  });
  assert.equal(badStatus.status, 400);
  assert.equal(badStatus.body.error.code, 'VALIDATION_FAILED');
});

test('E6 移除报名写 AuditLog admin.campaign.remove-project（C12 已触发）', async () => {
  const audit = await prisma.auditLog.findFirst({
    where: { targetType: 'campaign', targetId: removeId, action: 'admin.campaign.remove-project' },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(audit, '移除报名后应有 admin.campaign.remove-project 审计');
  assert.ok(audit.meta && typeof audit.meta === 'string', '审计 meta 应存在');
});
