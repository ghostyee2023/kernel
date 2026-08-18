/**
 * QA 规模冒烟（本地桩达成度证据）：模拟「一场活动 N 件作品 + M 人投票」，
 * 验证活动榜/配额/总票在规模化输入下仍准确。
 *
 * 运行：QA_PORT=3322 node --import tsx tests/qa/campaign-scale-smoke.ts
 * 前置：db:reset + next start -p 3322。
 */
import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.QA_PORT ?? 3322);
const BASE = `http://127.0.0.1:${PORT}`;
const prisma = new PrismaClient();

class Jar {
  map = new Map<string, string>();
  header() { return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(r: Response) {
    for (const raw of r.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(';')[0];
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      const k = pair.slice(0, idx).trim(), v = pair.slice(idx + 1).trim();
      if (v === '') this.map.delete(k); else this.map.set(k, v);
    }
  }
}
async function api(path: string, init: RequestInit & { jar?: Jar } = {}) {
  const { jar, ...rest } = init;
  const headers = new Headers(rest.headers ?? {});
  if (jar) headers.set('cookie', jar.header());
  if (rest.body) headers.set('content-type', 'application/json');
  const r = await fetch(`${BASE}${path}`, { ...rest, headers });
  jar?.absorb(r);
  let body: any; try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body };
}
async function login(jar: Jar, username: string) {
  return api('/api/auth/login', { method: 'POST', jar, body: JSON.stringify({ username, password: 'pw1' }) });
}

async function main() {
  // 1) 清理旧 smoke 数据
  await prisma.vote.deleteMany({ where: { campaign: { slug: 'qa-camp-scale' } } });
  const oldCamp = await prisma.campaign.findUnique({ where: { slug: 'qa-camp-scale' } });
  if (oldCamp) {
    await prisma.projectCampaign.deleteMany({ where: { campaignId: oldCamp.id } });
    await prisma.campaign.delete({ where: { id: oldCamp.id } });
  }

  // 2) 造 6 件 demo 作品并报名
  const demo = await prisma.user.findUniqueOrThrow({ where: { username: 'demo' } });
  const src = await prisma.project.findUniqueOrThrow({ where: { slug: 'Aur9raFx' } });
  const { id: _i, slug: _s, createdAt: _c, updatedAt: _u, ...rest } = src as any;
  const projectIds: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const slug = `QaScale${i}`;
    await prisma.project.deleteMany({ where: { slug } });
    const p = await prisma.project.create({ data: { ...rest, slug, title: `QA 规模作品 ${i}`, authorId: demo.id } });
    projectIds.push(p.id);
  }
  const now = Date.now();
  const camp = await prisma.campaign.create({
    data: {
      slug: 'qa-camp-scale',
      title: 'QA 规模活动',
      description: null,
      status: 'voting',
      authorId: demo.id,
      collectEndAt: new Date(now - 86400000),
      voteStartAt: new Date(now - 86400000),
      voteEndAt: new Date(now + 30 * 86400000),
      maxVotesPerUser: 3,
      allowSelfVote: true,
    },
  });
  for (const pid of projectIds) {
    await prisma.projectCampaign.create({ data: { campaignId: camp.id, projectId: pid, status: 'joined' } });
  }

  // 3) 12 个用户每人投 3 票（跨作品）
  const expected = new Map<string, number>(); // projectId -> campaign vote count
  for (let u = 1; u <= 12; u++) {
    const jar = new Jar();
    await login(jar, `qa-scale-u${u}`);
    for (let v = 0; v < 3; v++) {
      const pid = projectIds[(u + v) % projectIds.length];
      const res = await api('/api/votes', {
        method: 'POST', jar,
        body: JSON.stringify({ projectId: pid, campaignId: camp.id }),
      });
      if (res.status !== 200) throw new Error(`投票失败 u${u} v${v}: ${res.status} ${JSON.stringify(res.body)}`);
      expected.set(pid, (expected.get(pid) ?? 0) + 1);
    }
  }

  // 4) 与 DB 交叉核对
  const dbCount = await prisma.vote.groupBy({ by: ['projectId'], where: { campaignId: camp.id }, _count: { _all: true } });
  const dbMap = new Map(dbCount.map((r) => [r.projectId, r._count._all]));
  const totalVotes = 36;

  // 5) /api/rank?scope=campaign 排序核对
  const rank = await api(`/api/rank?scope=campaign&campaign=qa-camp-scale&limit=48`);
  if (rank.status !== 200) throw new Error(`rank 失败 ${rank.status}`);
  const items: any[] = rank.body.data;
  let ok = true;
  const msgs: string[] = [];
  if (items.length !== projectIds.length) { ok = false; msgs.push(`rank 数量 ${items.length} != ${projectIds.length}`); }
  for (const it of items) {
    const exp = dbMap.get(it.project.id) ?? 0;
    if (it.campaignVoteCount !== exp) { ok = false; msgs.push(`${it.project.slug}: rank ${it.campaignVoteCount} != db ${exp}`); }
  }
  for (let i = 1; i < items.length; i++) {
    if (items[i - 1].campaignVoteCount < items[i].campaignVoteCount) { ok = false; msgs.push('排序非降序'); break; }
  }
  const sum = items.reduce((s, it) => s + it.campaignVoteCount, 0);
  if (sum !== totalVotes) { ok = false; msgs.push(`活动票总数 ${sum} != ${totalVotes}`); }
  console.log(`[smoke] rank items=${items.length} totalCampaignVotes=${sum} orderDesc=${items.every((it, i) => i === 0 || items[i - 1].campaignVoteCount >= it.campaignVoteCount)}`);

  // 6) quota 端点：任一用户剩余应为 0
  const jar0 = new Jar();
  await login(jar0, 'qa-scale-u1');
  const quota = await api('/api/votes/quota?campaign=qa-camp-scale', { jar: jar0 });
  if (quota.body.data.remaining !== 0 || quota.body.data.used !== 3) { ok = false; msgs.push(`quota ${JSON.stringify(quota.body.data)}`); }
  console.log(`[smoke] quota used=${quota.body.data.used} remaining=${quota.body.data.remaining}`);

  // 7) 总榜含活动票：6 件作品 ProjectStats.voteCount 之和 = 36
  const stats = await prisma.projectStats.findMany({ where: { projectId: { in: projectIds } } });
  const globalSum = stats.reduce((s, r) => s + r.voteCount, 0);
  if (globalSum !== totalVotes) { ok = false; msgs.push(`ProjectStats 总票 ${globalSum} != ${totalVotes}`); }
  console.log(`[smoke] ProjectStats total=${globalSum}`);

  console.log(ok ? '[smoke] PASS ✅ 规模冒烟：6 作品 × 12 用户 × 3 票 = 36 票，榜/配额/总票全准确' : `[smoke] FAIL ❌ ${msgs.join('; ')}`);
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('[smoke] ERR', e); process.exit(1); });
