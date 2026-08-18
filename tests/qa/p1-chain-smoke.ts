/**
 * P1 第一阶段 QA 独立验证 —— 全链路冒烟（单脚本串起整条用户旅程）。
 *
 * 旅程：注册登录(任意用户) → 投票 → 重复投票幂等 → me 确认 →
 *      广场 sort=votes 确认排名 → 取消投票 → 重复取消幂等 → 退出 →
 *      退出后投票被拒(401) → admin 登录确认 ADMIN 角色。
 */
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.QA_PORT ?? 3322);
const BASE = `http://127.0.0.1:${PORT}`;
const prisma = new PrismaClient();

class Jar {
  private map = new Map<string, string>();
  apply(r: Response): void {
    for (const raw of r.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(';')[0];
      const i = pair.indexOf('=');
      if (i <= 0) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value === '') this.map.delete(name);
      else this.map.set(name, value);
    }
  }
  h(): string {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function req(path: string, init: RequestInit & { jar?: Jar } = {}) {
  const { jar, ...rest } = init;
  const headers = new Headers(rest.headers ?? {});
  if (jar) headers.set('cookie', jar.h());
  if (rest.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const r = await fetch(`${BASE}${path}`, { ...rest, headers, redirect: 'manual' });
  if (jar) jar.apply(r);
  const text = await r.text();
  let body: any = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

const results: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  assert.ok(cond, `[FAIL] ${name} ${detail}`);
}

async function main() {
  const jar = new Jar();
  const username = `e2e_${Date.now().toString(36)}`;

  // 1. 任意用户注册登录 → USER
  const login = await req('/api/auth/login', { method: 'POST', jar, body: JSON.stringify({ username, password: 'pw' }) });
  check('① 任意用户名登录成功', login.status === 200 && login.body.ok === true, `role=${login.body?.data?.user?.role}`);
  check('①b role=USER', login.body?.data?.user?.role === 'USER');

  // 2. 投票 → voted:true, count+1
  const pub = await prisma.project.findUnique({ where: { slug: 'Aur9raFx' }, select: { id: true } });
  const statsBefore = await prisma.projectStats.findUnique({ where: { projectId: pub!.id } });
  const before = statsBefore?.voteCount ?? 0;
  const v1 = await req('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: pub!.id }) });
  check('② 投票成功 voted:true', v1.body?.data?.voted === true, `count=${v1.body?.data?.voteCount}`);
  check('②b 票数 +1', v1.body?.data?.voteCount === before + 1, `before=${before} after=${v1.body?.data?.voteCount}`);

  // 3. 重复投票幂等
  const v2 = await req('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: pub!.id }) });
  check('③ 重复投票幂等', v2.body?.data?.voteCount === v1.body?.data?.voteCount && v2.body?.data?.voted === true);

  // 4. me 列表
  const me = await req('/api/votes/me', { jar });
  const ids = me.body?.data?.map((x: { projectId: string }) => x.projectId) ?? [];
  check('④ /api/votes/me 含本作品', ids.includes(pub!.id), `ids=${ids.join(',')}`);

  // 5. 广场 sort=votes 排名（本作品有票 → 应排在 0 票作品前）
  const plaza = await fetch(`${BASE}/?sort=votes`).then((r) => r.text());
  const idxAur = plaza.indexOf('Aur9raFx');
  const idxNeb = plaza.indexOf('NebuLa42');
  check('⑤ 广场 sort=votes 投票作品排前', idxAur !== -1 && idxNeb !== -1 && idxAur < idxNeb, `aur@${idxAur} neb@${idxNeb}`);

  // 6. 取消投票 → count-1
  const d1 = await req(`/api/votes/${pub!.id}`, { method: 'DELETE', jar });
  check('⑥ 取消投票 voted:false', d1.body?.data?.voted === false, `count=${d1.body?.data?.voteCount}`);
  check('⑥b 票数 -1', d1.body?.data?.voteCount === v1.body?.data?.voteCount - 1);

  // 7. 重复取消幂等
  const d2 = await req(`/api/votes/${pub!.id}`, { method: 'DELETE', jar });
  check('⑦ 重复取消幂等', d2.body?.data?.voteCount === d1.body?.data?.voteCount && d2.body?.data?.voted === false);

  // 8. 退出 → me null
  const out = await req('/api/auth/logout', { method: 'POST', jar });
  check('⑧ 退出登录', out.status === 200);
  const meAfter = await req('/api/auth/me', { jar });
  check('⑧b 退出后 me=null', meAfter.body?.data?.user === null);

  // 9. 退出后投票 → 401
  const vAfter = await req('/api/votes', { method: 'POST', jar, body: JSON.stringify({ projectId: pub!.id }) });
  check('⑨ 退出后投票被拒 401', vAfter.status === 401 && vAfter.body?.error?.code === 'NOT_LOGGED_IN');

  // 10. admin 登录
  const admin = new Jar();
  const ad = await req('/api/auth/login', { method: 'POST', jar: admin, body: JSON.stringify({ username: 'admin', password: '123456' }) });
  check('⑩ admin/123456 → ADMIN', ad.body?.data?.user?.role === 'ADMIN', `role=${ad.body?.data?.user?.role}`);

  // 11. admin 错误密码
  const adBad = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'bad' }) });
  check('⑪ admin 错误密码 → 400', adBad.status === 400 && adBad.body?.ok === false);

  console.log('\n===== P1 全链路冒烟 =====');
  for (const r of results) console.log(r);
  const fails = results.filter((r) => r.startsWith('FAIL'));
  console.log(`\nRESULT: ${results.length - fails.length}/${results.length} PASS`);
  await prisma.$disconnect();
  process.exitCode = fails.length > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error('CHAIN_FAILED:', e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
