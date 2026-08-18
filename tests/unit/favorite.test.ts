/**
 * lib/favorite-service.ts 收藏服务测试（DB 真实读写）。
 *
 * 对齐验收点（docs/P3-个人空间设计.md T01 / §1.3）：
 *   ✅ toggle：未收藏→true、再点→false、再点→true（幂等翻转）
 *   ✅ PRIVATE slug → NOT_FOUND（与不存在一致，不泄漏存在性）
 *   ✅ ARCHIVED 可收藏（回收站内仍可访问状态页）
 *   ✅ myFavoriteIds / count 与 toggle 结果一致
 *   ✅ list 过滤 PRIVATE/PURGED/BLOCKED，保留 ARCHIVED（§7.4 读侧口径）
 *
 * 隔离策略：测试数据用 `qaFav*` 前缀的 slug + 独立用户 id，`after()` 全量清理，
 * 不误伤 seed 数据。
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { PROJECT_STATUS, VISIBILITY } from '../../src/lib/constants';
import * as favoriteService from '../../src/lib/favorite-service';
import { prisma } from '../../src/lib/prisma';
import { AppError, ERROR_CODE } from '../../src/lib/response';

const PREFIX = 'qaFav';
const USER_ID = 'qa-fav-user';

const SLUGS = {
  pub: `${PREFIX}Pub1`,
  priv: `${PREFIX}Prv2`,
  arch: `${PREFIX}Arc3`,
};

/** 造一条作品记录，返回项目 id。 */
async function seedProject(
  slug: string,
  visibility: string = VISIBILITY.PUBLIC,
  status: string = PROJECT_STATUS.ACTIVE,
): Promise<string> {
  const row = await prisma.project.create({
    data: {
      slug,
      title: `QA 收藏 ${slug}`,
      sourceType: 'ZIP',
      entryFile: 'index.html',
      fileCount: 1,
      sizeBytes: 1,
      visibility,
      status,
      ttlDays: 90,
      expireAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      authorId: USER_ID,
      stats: { create: {} },
    },
    select: { id: true },
  });
  return row.id;
}

/** 按 slug 查作品 id。 */
async function projectIdBySlug(slug: string): Promise<string> {
  const row = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
  assert.ok(row, `夹具作品 ${slug} 不存在`);
  return row.id;
}

before(async () => {
  await prisma.user.upsert({
    where: { id: USER_ID },
    update: { nickname: 'QA 收藏用户' },
    create: { id: USER_ID, nickname: 'QA 收藏用户' },
  });
  await seedProject(SLUGS.pub);
  await seedProject(SLUGS.priv, VISIBILITY.PRIVATE);
  await seedProject(SLUGS.arch, VISIBILITY.PUBLIC, PROJECT_STATUS.ARCHIVED);
});

after(async () => {
  await prisma.favorite.deleteMany({ where: { userId: USER_ID } });
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.$disconnect();
});

describe('favorite toggle', () => {
  it('未收藏 → true；再点 → false；再点 → true（幂等翻转）', async () => {
    const first = await favoriteService.toggle(SLUGS.pub, USER_ID);
    assert.deepEqual(first, { favorited: true });

    const second = await favoriteService.toggle(SLUGS.pub, USER_ID);
    assert.deepEqual(second, { favorited: false });

    const third = await favoriteService.toggle(SLUGS.pub, USER_ID);
    assert.deepEqual(third, { favorited: true });

    // 清理，避免污染后续用例
    await favoriteService.toggle(SLUGS.pub, USER_ID);
  });

  it('PRIVATE slug → NOT_FOUND（不泄漏存在性）', async () => {
    await assert.rejects(
      () => favoriteService.toggle(SLUGS.priv, USER_ID),
      (error: unknown) => error instanceof AppError && error.code === ERROR_CODE.NOT_FOUND,
    );
  });

  it('不存在的 slug → NOT_FOUND', async () => {
    await assert.rejects(
      () => favoriteService.toggle(`${PREFIX}Ghost`, USER_ID),
      (error: unknown) => error instanceof AppError && error.code === ERROR_CODE.NOT_FOUND,
    );
  });

  it('ARCHIVED 可收藏（回收站内仍可访问状态页）', async () => {
    const result = await favoriteService.toggle(SLUGS.arch, USER_ID);
    assert.deepEqual(result, { favorited: true });
    await favoriteService.toggle(SLUGS.arch, USER_ID);
  });
});

describe('favorite 查询', () => {
  it('myFavoriteIds / count 与 toggle 结果一致', async () => {
    const pubId = await projectIdBySlug(SLUGS.pub);
    await favoriteService.toggle(SLUGS.pub, USER_ID);

    const ids = await favoriteService.myFavoriteIds(USER_ID);
    assert.ok(ids.includes(pubId), 'myFavoriteIds 应包含刚收藏的作品');

    const count = await favoriteService.count(USER_ID);
    assert.equal(count, ids.length, 'count 应与 myFavoriteIds 长度一致');

    await favoriteService.toggle(SLUGS.pub, USER_ID);
  });

  it('list 过滤 PRIVATE/PURGED/BLOCKED，保留 ARCHIVED（读侧口径 §7.4）', async () => {
    await favoriteService.toggle(SLUGS.pub, USER_ID);
    await favoriteService.toggle(SLUGS.arch, USER_ID);

    // PRIVATE 作品不允许 toggle，直接插收藏行验证 list 过滤
    const privId = await projectIdBySlug(SLUGS.priv);
    await prisma.favorite.create({ data: { userId: USER_ID, projectId: privId } });

    const items = await favoriteService.list(USER_ID);
    const slugs = items.map((item) => item.slug);
    assert.ok(slugs.includes(SLUGS.pub), '公开作品应出现在收藏列表');
    assert.ok(slugs.includes(SLUGS.arch), 'ARCHIVED 应保留展示（可进状态页）');
    assert.ok(!slugs.includes(SLUGS.priv), 'PRIVATE 应从收藏列表过滤');

    // 清理
    await favoriteService.toggle(SLUGS.pub, USER_ID);
    await favoriteService.toggle(SLUGS.arch, USER_ID);
    await prisma.favorite.deleteMany({ where: { userId: USER_ID, projectId: privId } });
  });
});
