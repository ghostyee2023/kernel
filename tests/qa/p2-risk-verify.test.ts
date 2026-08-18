/**
 * P2 风控模块 —— QA Engineer 独立验证（全新视角，不信任工程师自验）。
 *
 * 覆盖（以 docs/P2-风控模块设计.md 已拍板规则为准）：
 *   C 投票链路（HTTP 层）：带 deviceHash 投票落库（ip/deviceHash/dwellMs/riskScore）；
 *     同 IP 1min 第 5 票 riskScore≥30（IP_HIGH_FREQ）；同设备 3 账号 riskScore≥35
 *     （DEVICE_MULTI_ACCOUNT）；不带 campaignId 与 P1 全站赞一致（p1-http 24/24 兜底）；
 *     unvote 已作废票只删行不减票。
 *   D audit 聚合：seed 数据 .30 高危 80 / .10 可疑 55；按 ip/device 分组正确；
 *     分页/筛选（suspiciousOnly / pageSize）；col 白名单（非法 group → 400）。
 *   E invalidate + 榜单重算（核心）：
 *     - voteIds 模式作废 2 票 → ProjectStats.voteCount===COUNT(valid=true)、
 *       voteInvalid 累加、AuditLog admin.votes.invalidate（targetId batch:{uuid}）；
 *     - scope device 模式作废 3 票（含 campaignId 限定语义）→ 同上；幂等（再作废 invalidated=0）；
 *     - 二选一校验（都缺/都有 → 400）；reason 缺 → 400；非 ADMIN → 403；未登录 → 401；
 *     - 作废后 quota 退回（used 只计 valid）；同 (projectId,userId) 不可重投（幂等不重复计票）。
 *
 * 运行前提：
 *   1) `npm run db:reset`（seed 含 11 刷票票 + admin/demo + camp-demo1）+ p1-fixtures
 *   2) `next build` + `next start -p <QA_PORT>`（SITE_URL=http://127.0.0.1:<QA_PORT>）
 *   3) QA_PORT=3322 SITE_URL=... node --require ./tests/qa/qa-register.cjs
 *      --import tsx --test tests/qa/p2-risk-verify.test.ts
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
  init: RequestInit & { jar?: CookieJar; xff?: string } = {},
): Promise<{ status: number; body: any }> {
  const { jar, xff, ...rest } = init;
  const headers = new Headers(rest.headers ?? {});
  if (jar) headers.set('cookie', jar.header());
  if (xff) headers.set('x-forwarded-for', xff);
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

let adminJar: CookieJar;

let auroraId = '';
let nebulaId = '';
let pulseId = '';
let demo1Id = '';

/** 记录作品在作废前的 stats 基线（voteCount / voteInvalid）。 */
async function statsOf(projectId: string) {
  const row = await prisma.projectStats.findUnique({ where: { projectId } });
  return { voteCount: row?.voteCount ?? 0, voteInvalid: row?.voteInvalid ?? 0 };
}

/** 清除指定用户名的全部票（保证测试可重复运行，幂等）。 */
async function clearUserVotes(username: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return;
  await prisma.vote.deleteMany({ where: { userId: user.id } });
}

before(async () => {
  const aurora = await prisma.project.findUnique({ where: { slug: 'Aur9raFx' } });
  const nebula = await prisma.project.findUnique({ where: { slug: 'NebuLa42' } });
  const pulse = await prisma.project.findUnique({ where: { slug: 'PuLse7Kd' } });
  assert.ok(aurora && nebula && pulse, 'seed 作品缺失');
  auroraId = aurora.id;
  nebulaId = nebula.id;
  pulseId = pulse.id;

  const demo1 = await prisma.campaign.findUniqueOrThrow({ where: { slug: 'camp-demo1' } });
  demo1Id = demo1.id;

  adminJar = new CookieJar();
  await login(adminJar, 'admin', '123456');
});

after(async () => {
  await prisma.$disconnect();
});

/* ============================================================================
   C 投票链路（HTTP 层）
   ========================================================================== */

test('C1 带 deviceHash/dwellMs + x-forwarded-for 投票 → Vote 落库 ip/deviceHash/dwellMs/riskScore', async () => {
  await clearUserVotes('qa-risk-c1');
  const jar = new CookieJar();
  await login(jar, 'qa-risk-c1', 'pw1');
  const res = await api('/api/votes', {
    method: 'POST',
    jar,
    xff: '198.51.100.201',
    body: JSON.stringify({ projectId: auroraId, deviceHash: 'qa-dev-c1-aaaa', dwellMs: 4321 }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.voted, true);

  const row = await prisma.vote.findUnique({ where: { projectId_userId: { projectId: auroraId, userId: res.body.data.userId ?? (await prisma.user.findUniqueOrThrow({ where: { username: 'qa-risk-c1' } })).id } } });
  assert.ok(row, 'vote 行应存在');
  assert.equal(row.ip, '198.51.100.201', 'x-forwarded-for 首值应落库');
  assert.equal(row.deviceHash, 'qa-dev-c1-aaaa');
  assert.equal(row.dwellMs, 4321);
  assert.equal(row.valid, true);
  assert.equal(typeof row.riskScore, 'number');
  assert.equal(row.riskScore, 0, '首票（无历史）riskScore 应为 0');
});

test('C2 同 IP 1min 内第 5 票 → riskScore ≥ 30（IP_HIGH_FREQ 触发）', async () => {
  // 5 个不同用户、同一 IP、同一作品（每人一票，避开 @@unique）
  const IP = '198.51.100.220';
  for (let i = 1; i <= 5; i += 1) await clearUserVotes(`qa-risk-freq-${i}`);
  let lastScore = 0;
  for (let i = 1; i <= 5; i += 1) {
    const jar = new CookieJar();
    await login(jar, `qa-risk-freq-${i}`, 'pw1');
    const res = await api('/api/votes', {
      method: 'POST',
      jar,
      xff: IP,
      body: JSON.stringify({ projectId: nebulaId, deviceHash: `qa-dev-freq-${i}`, dwellMs: 1000 + i }),
    });
    assert.equal(res.status, 200);
    const user = await prisma.user.findUniqueOrThrow({ where: { username: `qa-risk-freq-${i}` } });
    const row = await prisma.vote.findUnique({ where: { projectId_userId: { projectId: nebulaId, userId: user.id } } });
    assert.ok(row);
    assert.equal(row.ip, IP);
    lastScore = row.riskScore;
  }
  assert.ok(lastScore >= 30, `同 IP 第 5 票 riskScore=${lastScore} 应 ≥30（IP_HIGH_FREQ）`);
  // 同 IP 5 票 + 同 IP 3 账号（5 个账号）→ 30+25=55 是确定值
  assert.equal(lastScore, 55, 'IP_HIGH_FREQ(30)+IP_MULTI_ACCOUNT(25)=55');
});

test('C3 同设备 3 账号 → riskScore ≥ 35（DEVICE_MULTI_ACCOUNT 触发）', async () => {
  const DEV = 'qa-dev-multi-9abc';
  const projects = [auroraId, nebulaId, pulseId];
  for (let i = 1; i <= 3; i += 1) await clearUserVotes(`qa-risk-dev-${i}`);
  let lastScore = 0;
  for (let i = 1; i <= 3; i += 1) {
    const jar = new CookieJar();
    await login(jar, `qa-risk-dev-${i}`, 'pw1');
    // 不同 IP（避免同 IP 多账号干扰），同设备
    const res = await api('/api/votes', {
      method: 'POST',
      jar,
      xff: `198.51.100.23${i}`,
      body: JSON.stringify({ projectId: projects[i - 1], deviceHash: DEV, dwellMs: 500 }),
    });
    assert.equal(res.status, 200);
    const user = await prisma.user.findUniqueOrThrow({ where: { username: `qa-risk-dev-${i}` } });
    const row = await prisma.vote.findUnique({ where: { projectId_userId: { projectId: projects[i - 1], userId: user.id } } });
    assert.ok(row);
    assert.equal(row.deviceHash, DEV);
    lastScore = row.riskScore;
  }
  assert.ok(lastScore >= 35, `同设备第 3 账号 riskScore=${lastScore} 应 ≥35（DEVICE_MULTI_ACCOUNT）`);
});

test('C4 不带 campaignId 投票 → 与 P1 全站赞一致（无活动字段、可投票）', async () => {
  await clearUserVotes('qa-risk-nocamp');
  const jar = new CookieJar();
  await login(jar, 'qa-risk-nocamp', 'pw1');
  const before = await statsOf(pulseId);
  const res = await api('/api/votes', {
    method: 'POST',
    jar,
    body: JSON.stringify({ projectId: pulseId }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.voted, true);
  assert.equal(res.body.data.voteCount, before.voteCount + 1);
  assert.equal(res.body.data.campaignVoteCount, undefined);
  assert.equal(res.body.data.remainingQuota, undefined);
});

test('C5 unvote 已作废票 → 只删行不减票（voteCount 不回退）', async () => {
  // 专用用户投一票
  const jar = new CookieJar();
  await login(jar, 'qa-risk-unv', 'pw1');
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'qa-risk-unv' } });
  await prisma.vote.deleteMany({ where: { userId: user.id } });

  const v = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: auroraId }) });
  assert.equal(v.status, 200);
  const voteRow = await prisma.vote.findUnique({ where: { projectId_userId: { projectId: auroraId, userId: user.id } } });
  assert.ok(voteRow);

  // 管理员作废该票（valid=false，行保留；票数应 -1）
  const inv = await api('/api/admin/votes/invalidate', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ voteIds: [voteRow.id], reason: 'QA unvote 验证作废' }),
  });
  assert.equal(inv.status, 200);
  assert.equal(inv.body.data.invalidated, 1);
  const invalidatedRow = await prisma.vote.findUnique({ where: { id: voteRow.id } });
  assert.ok(invalidatedRow);
  assert.equal(invalidatedRow.valid, false);
  const afterInvalidate = await statsOf(auroraId);

  // 用户取消（DELETE）→ 只删行，票数不减（作废后基线）
  const d = await api(`/api/votes/${auroraId}`, { method: 'DELETE', jar });
  assert.equal(d.status, 200);
  assert.equal(d.body.data.voted, false);
  const after = await statsOf(auroraId);
  assert.equal(after.voteCount, afterInvalidate.voteCount, '作废票取消后票数不应再减（防双扣 D3）');
  const gone = await prisma.vote.findUnique({ where: { id: voteRow.id } });
  assert.equal(gone, null, '作废票被取消后行应删除');
});

/* ============================================================================
   D audit 聚合
   ========================================================================== */

test('D1 audit 按 ip 分组：seed .30 高危 80、.10 可疑 55；票数/账号数/作品数正确', async () => {
  const res = await api('/api/admin/votes/audit?group=ip&pageSize=100', { jar: adminJar });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const rows = res.body.data as any[];

  const g30 = rows.find((r) => r.key === '203.0.113.30');
  assert.ok(g30, '.30 分组应存在');
  assert.equal(g30.maxRiskScore, 80, '.30 最高风险应为 80（高危）');
  assert.equal(g30.riskLevel, 'high');
  assert.equal(g30.voteCount, 3, '.30 应有 3 票');
  assert.equal(g30.accountCount, 3, '.30 应关联 3 个账号');
  assert.equal(g30.projectCount, 3, '.30 应覆盖 3 件作品');
  assert.equal(g30.validCount, 3);

  const g10 = rows.find((r) => r.key === '203.0.113.10');
  assert.ok(g10, '.10 分组应存在');
  assert.equal(g10.maxRiskScore, 55, '.10 最高风险应为 55（可疑）');
  assert.equal(g10.riskLevel, 'suspect');
  assert.equal(g10.voteCount, 5, '.10 应有 5 票');
  assert.equal(g10.accountCount, 3, '.10 应关联 3 个账号');
  assert.equal(g10.validCount, 5);
});

test('D2 audit 按 device 分组：dev-abuse-5b2e 高危 80、dev-shared-7f3a 可疑 55', async () => {
  const res = await api('/api/admin/votes/audit?group=device&pageSize=100', { jar: adminJar });
  assert.equal(res.status, 200);
  const rows = res.body.data as any[];
  const abuse = rows.find((r) => r.key === 'dev-abuse-5b2e');
  assert.ok(abuse);
  assert.equal(abuse.maxRiskScore, 80);
  assert.equal(abuse.accountCount, 3);
  const shared = rows.find((r) => r.key === 'dev-shared-7f3a');
  assert.ok(shared);
  assert.equal(shared.maxRiskScore, 55);
});

test('D3 suspiciousOnly=1 → 只返回 maxRiskScore≥30 的分组', async () => {
  const res = await api('/api/admin/votes/audit?group=ip&suspiciousOnly=1&pageSize=100', { jar: adminJar });
  assert.equal(res.status, 200);
  const rows = res.body.data as any[];
  assert.ok(rows.length >= 3, '至少应有 .10/.30 等可疑分组');
  for (const row of rows) {
    assert.ok(row.maxRiskScore >= 30, `可疑分组 maxRiskScore 应≥30，实际 ${row.maxRiskScore}（${row.key}）`);
  }
});

test('D4 audit 分页 pageSize 生效 + 非法 group → 400（col 白名单防注入）', async () => {
  const page = await api('/api/admin/votes/audit?group=ip&pageSize=2&page=1', { jar: adminJar });
  assert.equal(page.status, 200);
  assert.ok((page.body.data as any[]).length <= 2, 'pageSize=2 每页最多 2 条');
  assert.equal(page.body.meta.pageSize, 2);

  const bad = await api('/api/admin/votes/audit?group=evil%3B%20DROP%20TABLE', { jar: adminJar });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION_FAILED');
});

test('D5 audit/detail：group=ip&key=203.0.113.30 → 3 条明细含作品/用户/风险分', async () => {
  const res = await api('/api/admin/votes/audit/detail?group=ip&key=203.0.113.30&pageSize=20', { jar: adminJar });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const rows = res.body.data as any[];
  assert.equal(res.body.meta.total, 3);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.ip, '203.0.113.30');
    assert.equal(row.riskScore, 80);
    assert.equal(row.valid, true);
    assert.equal(typeof row.slug, 'string');
    assert.equal(typeof row.nickname, 'string');
    assert.ok(row.projectId);
  }
  // 缺少 key → 400
  const noKey = await api('/api/admin/votes/audit/detail?group=ip', { jar: adminJar });
  assert.equal(noKey.status, 400);
  assert.equal(noKey.body.error.code, 'VALIDATION_FAILED');
});

test('D6 audit 鉴权：未登录 401 / 普通用户 403', async () => {
  const unauth = await api('/api/admin/votes/audit');
  assert.equal(unauth.status, 401);
  assert.equal(unauth.body.error.code, 'NOT_LOGGED_IN');

  const userJar = new CookieJar();
  await login(userJar, 'qa-risk-norm', 'pw1');
  const user = await api('/api/admin/votes/audit', { jar: userJar });
  assert.equal(user.status, 403);
});

/* ============================================================================
   E invalidate + 榜单重算（核心）
   ========================================================================== */

test('E1 voteIds 模式作废 2 票 → voteCount===COUNT(valid=true)、voteInvalid 累加、AuditLog 留痕', async () => {
  // 专用用户投 2 票（不同作品）
  const jar1 = new CookieJar();
  await login(jar1, 'qa-risk-e1a', 'pw1');
  const jar2 = new CookieJar();
  await login(jar2, 'qa-risk-e1b', 'pw1');
  // 幂等：先清掉历史票（本用户可能已投过）
  await clearUserVotes('qa-risk-e1a');
  await clearUserVotes('qa-risk-e1b');
  await api('/api/votes', { method: 'POST', jar: jar1, body: JSON.stringify({ projectId: auroraId }) });
  await api('/api/votes', { method: 'POST', jar: jar2, body: JSON.stringify({ projectId: nebulaId }) });

  const u1 = await prisma.user.findUniqueOrThrow({ where: { username: 'qa-risk-e1a' } });
  const u2 = await prisma.user.findUniqueOrThrow({ where: { username: 'qa-risk-e1b' } });
  const v1 = await prisma.vote.findUnique({ where: { projectId_userId: { projectId: auroraId, userId: u1.id } } });
  const v2 = await prisma.vote.findUnique({ where: { projectId_userId: { projectId: nebulaId, userId: u2.id } } });
  assert.ok(v1 && v2);

  const statsA = await statsOf(auroraId);
  const statsN = await statsOf(nebulaId);

  const inv = await api('/api/admin/votes/invalidate', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ voteIds: [v1.id, v2.id], reason: 'QA E1 批量作废验证' }),
  });
  assert.equal(inv.status, 200);
  assert.equal(inv.body.ok, true);
  assert.equal(inv.body.data.invalidated, 2, '应实际作废 2 票');
  assert.equal(inv.body.data.affectedProjects.length, 2, '应涉及 2 件作品');
  assert.ok(inv.body.data.batchId, '应返回 batchId');
  assert.match(inv.body.data.batchId, /^[0-9a-f-]{36}$/, 'batchId 应为 UUID');

  // 榜单重算：voteCount === COUNT(valid=true)
  const validA = await prisma.vote.count({ where: { projectId: auroraId, valid: true } });
  const validN = await prisma.vote.count({ where: { projectId: nebulaId, valid: true } });
  const afterA = await statsOf(auroraId);
  const afterN = await statsOf(nebulaId);
  assert.equal(afterA.voteCount, validA, `Aur9raFx voteCount(${afterA.voteCount}) 应等于 COUNT(valid=true)(${validA})`);
  assert.equal(afterN.voteCount, validN, `NebuLa42 voteCount(${afterN.voteCount}) 应等于 COUNT(valid=true)(${validN})`);
  assert.equal(afterA.voteInvalid, statsA.voteInvalid + 1, 'Aur9raFx voteInvalid 应 +1');
  assert.equal(afterN.voteInvalid, statsN.voteInvalid + 1, 'NebuLa42 voteInvalid 应 +1');

  // 票行保留 valid=false + reason
  const v1After = await prisma.vote.findUnique({ where: { id: v1.id } });
  assert.ok(v1After);
  assert.equal(v1After.valid, false);
  assert.equal(v1After.invalidReason, 'QA E1 批量作废验证');

  // AuditLog：admin.votes.invalidate，targetId=batch:{uuid}
  const audit = await prisma.auditLog.findFirst({
    where: { action: 'admin.votes.invalidate', targetId: `batch:${inv.body.data.batchId}` },
  });
  assert.ok(audit, '应存在 admin.votes.invalidate 审计');
  assert.equal(audit.targetType, 'vote');
  assert.match(audit.targetId, /^batch:[0-9a-f-]{36}$/);
  const meta = JSON.parse(audit.meta ?? '{}');
  assert.equal(meta.count, 2);
  assert.equal(meta.reason, 'QA E1 批量作废验证');
  assert.ok(Array.isArray(meta.affectedProjects) && meta.affectedProjects.length === 2);
});

test('E2 幂等：对已作废票再作废 → invalidated=0（不报错）', async () => {
  // 先找一张已作废的票（E1 产生的）
  const invalidVote = await prisma.vote.findFirst({ where: { valid: false } });
  assert.ok(invalidVote, '应存在已作废票');
  const res = await api('/api/admin/votes/invalidate', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ voteIds: [invalidVote.id], reason: 'QA E2 幂等验证' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.invalidated, 0);
});

test('E3 scope device 模式作废 3 票 → 全部该设备有效票作废；幂等 invalidated=0', async () => {
  const DEV = 'qa-dev-scope-e3';
  const projects = [auroraId, nebulaId, pulseId];
  for (let i = 1; i <= 3; i += 1) await clearUserVotes(`qa-risk-e3-${i}`);
  for (let i = 1; i <= 3; i += 1) {
    const jar = new CookieJar();
    await login(jar, `qa-risk-e3-${i}`, 'pw1');
    const res = await api('/api/votes', {
      method: 'POST',
      jar,
      xff: `198.51.100.3${i}`,
      body: JSON.stringify({ projectId: projects[i - 1], deviceHash: DEV, dwellMs: 300 }),
    });
    assert.equal(res.status, 200);
  }

  const inv = await api('/api/admin/votes/invalidate', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ scope: { type: 'device', value: DEV }, reason: 'QA E3 按设备作废' }),
  });
  assert.equal(inv.status, 200);
  assert.equal(inv.body.data.invalidated, 3, '应作废该设备全部 3 张有效票');
  assert.equal(inv.body.data.affectedProjects.length, 3);

  const remaining = await prisma.vote.count({ where: { deviceHash: DEV, valid: true } });
  assert.equal(remaining, 0, '该设备不应再有有效票');

  // 幂等：再作废 → 0
  const again = await api('/api/admin/votes/invalidate', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ scope: { type: 'device', value: DEV }, reason: 'QA E3 幂等' }),
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.invalidated, 0);
});

test('E4 scope + campaignId 限定：只作废该活动内的票', async () => {
  const DEV = 'qa-dev-scope-camp';
  // 同一设备、同一用户：一票活动票（camp-demo1 的 aurora）+ 一票全站赞（pulse）
  const jar = new CookieJar();
  await login(jar, 'qa-risk-e4', 'pw1');
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'qa-risk-e4' } });
  await prisma.vote.deleteMany({ where: { userId: user.id } });

  const campVote = await api('/api/votes', {
    method: 'POST',
    jar,
    body: JSON.stringify({ projectId: auroraId, campaignId: demo1Id, deviceHash: DEV, dwellMs: 100 }),
  });
  assert.equal(campVote.status, 200);
  const plainVote = await api('/api/votes', {
    method: 'POST',
    jar,
    body: JSON.stringify({ projectId: pulseId, deviceHash: DEV, dwellMs: 100 }),
  });
  assert.equal(plainVote.status, 200);

  // 限定 campaignId=demo1 作废 → 只作废活动票，全站赞票保留
  const inv = await api('/api/admin/votes/invalidate', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ scope: { type: 'device', value: DEV }, campaignId: demo1Id, reason: 'QA E4 活动限定作废' }),
  });
  assert.equal(inv.status, 200);
  assert.equal(inv.body.data.invalidated, 1, 'campaign 限定下只作废活动票');

  const plainAfter = await prisma.vote.findFirst({ where: { deviceHash: DEV, projectId: pulseId } });
  assert.ok(plainAfter, '全站赞票应保留');
  assert.equal(plainAfter.valid, true);
});

test('E5 参数校验：voteIds 与 scope 都缺/都有 → 400；reason 缺 → 400', async () => {
  const bothMissing = await api('/api/admin/votes/invalidate', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ reason: 'QA' }),
  });
  assert.equal(bothMissing.status, 400);
  assert.equal(bothMissing.body.error.code, 'VALIDATION_FAILED');

  const bothPresent = await api('/api/admin/votes/invalidate', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ voteIds: ['x'], scope: { type: 'ip', value: '1.2.3.4' }, reason: 'QA' }),
  });
  assert.equal(bothPresent.status, 400);

  const noReason = await api('/api/admin/votes/invalidate', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ scope: { type: 'ip', value: '1.2.3.4' } }),
  });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.error.code, 'VALIDATION_FAILED');
});

test('E6 invalidate 鉴权：未登录 401 / 普通用户 403', async () => {
  const unauth = await api('/api/admin/votes/invalidate', {
    method: 'POST',
    body: JSON.stringify({ voteIds: ['x'], reason: 'QA' }),
  });
  assert.equal(unauth.status, 401);
  assert.equal(unauth.body.error.code, 'NOT_LOGGED_IN');

  const userJar = new CookieJar();
  await login(userJar, 'qa-risk-e6user', 'pw1');
  const user = await api('/api/admin/votes/invalidate', {
    method: 'POST',
    jar: userJar,
    body: JSON.stringify({ voteIds: ['x'], reason: 'QA' }),
  });
  assert.equal(user.status, 403);
  assert.equal(user.body.error.code, 'FORBIDDEN');
});

test('E7 作废后 quota 退回（used 只计 valid=true）', async () => {
  // 专用用户投 2 张活动票（camp-demo1 max=3：aurora + nebula）
  const jar = new CookieJar();
  await login(jar, 'qa-risk-e7', 'pw1');
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'qa-risk-e7' } });
  await prisma.vote.deleteMany({ where: { userId: user.id } });

  const v1 = await api('/api/votes', {
    method: 'POST',
    jar,
    body: JSON.stringify({ projectId: auroraId, campaignId: demo1Id, deviceHash: 'qa-dev-e7', dwellMs: 50 }),
  });
  assert.equal(v1.status, 200);
  const v2 = await api('/api/votes', {
    method: 'POST',
    jar,
    body: JSON.stringify({ projectId: nebulaId, campaignId: demo1Id, deviceHash: 'qa-dev-e7', dwellMs: 50 }),
  });
  assert.equal(v2.status, 200);

  const quotaBefore = await api('/api/votes/quota?campaign=camp-demo1', { jar });
  assert.equal(quotaBefore.body.data.used, 2);
  assert.equal(quotaBefore.body.data.remaining, 1);

  // 作废其中 1 票（aurora）
  const rowAurora = await prisma.vote.findUnique({ where: { projectId_userId: { projectId: auroraId, userId: user.id } } });
  assert.ok(rowAurora);
  const inv = await api('/api/admin/votes/invalidate', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ voteIds: [rowAurora.id], reason: 'QA E7 quota 退回' }),
  });
  assert.equal(inv.body.data.invalidated, 1);

  const quotaAfter = await api('/api/votes/quota?campaign=camp-demo1', { jar });
  assert.equal(quotaAfter.body.data.used, 1, '作废后 used 只计有效票');
  assert.equal(quotaAfter.body.data.remaining, 2, 'quota 应退回');
});

test('E8 作废后同 (projectId,userId) 不可重投（幂等不重复计票）', async () => {
  const jar = new CookieJar();
  await login(jar, 'qa-risk-e8', 'pw1');
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'qa-risk-e8' } });
  await clearUserVotes('qa-risk-e8');

  const v = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: auroraId }) });
  assert.equal(v.status, 200);
  const row = await prisma.vote.findUnique({ where: { projectId_userId: { projectId: auroraId, userId: user.id } } });
  assert.ok(row);

  // 作废 → 票数 -1（作废基线）
  await api('/api/admin/votes/invalidate', {
    method: 'POST',
    jar: adminJar,
    body: JSON.stringify({ voteIds: [row.id], reason: 'QA E8 防重投' }),
  });
  const statsAfterInvalidate = await statsOf(auroraId);

  // 同用户再投同一作品 → 幂等返回（不新增计票，行保留 valid=false）
  const retry = await api('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: auroraId }) });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.voted, true, '按钮保持已投态（hasVoted 不过滤，Q5/Q6）');
  const statsAfter = await statsOf(auroraId);
  assert.equal(statsAfter.voteCount, statsAfterInvalidate.voteCount, '重投不应重复计票');
  const rowAfter = await prisma.vote.findUnique({ where: { id: row.id } });
  assert.ok(rowAfter);
  assert.equal(rowAfter.valid, false, '作废行保留（@@unique 占位，不可重投）');
});
