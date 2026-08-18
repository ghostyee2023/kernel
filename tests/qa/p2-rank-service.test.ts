/**
 * P1 收尾 QA 独立验证 —— 排行榜服务层（projectService.rank 口径）。
 *
 * 直接调用 `rank()`，验证：只收 PUBLIC + ACTIVE + voteCount>0；
 * 按 voteCount desc, createdAt desc；排除 UNLISTED / PRIVATE / ARCHIVED；limit 生效。
 *
 * 运行：DATABASE_URL=... node --import tsx --test tests/qa/p2-rank-service.test.ts
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';

import { PrismaClient } from '@prisma/client';

import { LOCAL_DEMO_USER_ID, PROJECT_STATUS, VISIBILITY } from '@/lib/constants';
import * as projectService from '@/lib/project-service';

const prisma = new PrismaClient();

let aurId = '';
let nebId = '';
let unpId = '';
let privId = '';
let archId = '';

before(async () => {
  await prisma.vote.deleteMany({});
  await prisma.projectStats.updateMany({ data: { voteCount: 0 } });

  const src = await prisma.project.findUnique({ where: { slug: 'Aur9raFx' } });
  assert.ok(src);

  // 造 PRIVATE / ARCHIVED 夹具（voteCount 由测试显式设置）
  for (const spec of [
    { slug: 'QaPrivRk', title: '[QA] PRIVATE', visibility: 'PRIVATE', status: 'ACTIVE' },
    { slug: 'QaArchRk', title: '[QA] ARCHIVED', visibility: 'PUBLIC', status: 'ARCHIVED' },
  ]) {
    await prisma.project.deleteMany({ where: { slug: spec.slug } });
    const { id: _id, slug: _s, createdAt: _c, updatedAt: _u, ...rest } = src;
    await prisma.project.create({
      data: { ...rest, slug: spec.slug, title: spec.title, visibility: spec.visibility, status: spec.status, stats: { create: {} } },
    });
  }

  const ids = await prisma.project.findMany({
    where: { slug: { in: ['Aur9raFx', 'NebuLa42', 'PuLse7Kd', 'QaPrivRk', 'QaArchRk'] } },
    select: { slug: true, id: true },
  });
  aurId = ids.find((x) => x.slug === 'Aur9raFx')!.id;
  nebId = ids.find((x) => x.slug === 'NebuLa42')!.id;
  unpId = ids.find((x) => x.slug === 'PuLse7Kd')!.id;
  privId = ids.find((x) => x.slug === 'QaPrivRk')!.id;
  archId = ids.find((x) => x.slug === 'QaArchRk')!.id;
});

after(async () => {
  await prisma.$disconnect();
});

test('R1 无票时 rank() 返回空数组', async () => {
  const items = await projectService.rank();
  assert.deepEqual(items, []);
});

test('R2 造票后 rank() 只收 PUBLIC+ACTIVE+voteCount>0，且按票数倒序', async () => {
  await prisma.projectStats.update({ where: { projectId: aurId }, data: { voteCount: 3 } });
  await prisma.projectStats.update({ where: { projectId: nebId }, data: { voteCount: 2 } });
  // UNLISTED / PRIVATE / ARCHIVED 都给高票，验证被排除
  await prisma.projectStats.update({ where: { projectId: unpId }, data: { voteCount: 9 } });
  await prisma.projectStats.update({ where: { projectId: privId }, data: { voteCount: 8 } });
  await prisma.projectStats.update({ where: { projectId: archId }, data: { voteCount: 7 } });

  const items = await projectService.rank();
  assert.equal(items.length, 2, '仅 2 件 PUBLIC ACTIVE 上榜');
  assert.equal(items[0].slug, 'Aur9raFx');
  assert.equal(items[0].voteCount, 3);
  assert.equal(items[1].slug, 'NebuLa42');
  assert.equal(items[1].voteCount, 2);
  assert.equal(items[0].authorId, LOCAL_DEMO_USER_ID, 'DTO 携带 authorId');
  assert.equal(typeof items[0].authorName, 'string');
  assert.equal(typeof items[0].detailUrl, 'string');
  assert.ok(items[0].detailUrl.includes(`/w/${items[0].slug}`), 'detailUrl 指向 /w/[slug]');
});

test('R3 票数相同时按 createdAt desc（新的在前）', async () => {
  // NebuLa42 与一个新建的 PUBLIC ACTIVE 作品同票 → createdAt 新的在前
  const src = await prisma.project.findUnique({ where: { slug: 'Aur9raFx' } });
  assert.ok(src);
  const newSlug = 'QaNewRk';
  await prisma.project.deleteMany({ where: { slug: newSlug } });
  const { id: _id, slug: _s, createdAt: _c, updatedAt: _u, ...rest } = src;
  const created = await prisma.project.create({
    data: {
      ...rest,
      slug: newSlug,
      title: '[QA] 新建同票',
      visibility: 'PUBLIC',
      status: 'ACTIVE',
      stats: { create: {} },
    },
    select: { id: true },
  });
  await prisma.projectStats.update({ where: { projectId: created.id }, data: { voteCount: 2 } });

  const items = await projectService.rank();
  const idxNew = items.findIndex((x) => x.slug === newSlug);
  const idxNeb = items.findIndex((x) => x.slug === 'NebuLa42');
  assert.ok(idxNew !== -1 && idxNeb !== -1);
  assert.ok(idxNew < idxNeb, '同票时新建作品应排前（createdAt desc）');
});

test('R4 limit 参数生效', async () => {
  const items = await projectService.rank(1);
  assert.equal(items.length, 1);
  assert.equal(items[0].slug, 'Aur9raFx');
});
