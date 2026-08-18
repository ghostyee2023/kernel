/**
 * lib/lifecycle.ts 生命周期状态机测试（DB + 磁盘真实读写）。
 *
 * 对齐验收点（docs/P0-架构与任务分解.md T03）：
 *   ✅ expireAt 改到过去 → archive → 状态 ARCHIVED、purgeAt = +30d、CleanupLog 有记录
 *   ✅ purgeAt 改到过去 → purge → 目录消失、状态 PURGED、freedBytes > 0
 *   ✅ 未到期的作品不应被归档；exemptExpire 的作品永不归档
 *
 * 隔离策略：所有测试数据用 `qaLife*` 前缀的 slug，`after()` 全量清理，
 * 且注入的 `now` 恒为真实当前时间，避免误伤 seed 数据。
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { LOCAL_DEMO_USER_ID, PROJECT_STATUS, RECYCLE_BIN_DAYS, UPLOAD_SESSION_TTL_MS } from '../../src/lib/constants';
import { MS_PER_DAY } from '../../src/lib/format';
import { archiveExpired, gcTmp, newBatchId, purgeArchived, runAll, scanOrphans } from '../../src/lib/lifecycle';
import { prisma } from '../../src/lib/prisma';
import { ensureDataSkeleton, resolveProjectDir, resolveTmpDir, tmpRoot } from '../../src/lib/storage';

/** 测试作品 slug 前缀，用于精准清理。 */
const PREFIX = 'qaLife';
const SLUGS = {
  expired: `${PREFIX}Exp1`,
  fresh: `${PREFIX}Fre2`,
  exempt: `${PREFIX}Exe3`,
  purgeReady: `${PREFIX}Pur4`,
  orphan: `${PREFIX}Orp5`,
} as const;

const TMP_OLD = 'qaLifeTmpOld001';
const TMP_NEW = 'qaLifeTmpNew001';

/** 造一条作品记录 + 对应磁盘目录。 */
async function seedProject(params: {
  slug: string;
  expireAt: Date;
  status?: string;
  purgeAt?: Date | null;
  exemptExpire?: boolean;
  bytes?: number;
}): Promise<string> {
  const dir = resolveProjectDir(params.slug);
  await fs.mkdir(dir, { recursive: true });
  const content = 'x'.repeat(params.bytes ?? 128);
  await fs.writeFile(path.join(dir, 'index.html'), content);

  const row = await prisma.project.create({
    data: {
      slug: params.slug,
      title: `QA 生命周期 ${params.slug}`,
      sourceType: 'ZIP',
      entryFile: 'index.html',
      fileCount: 1,
      sizeBytes: content.length,
      visibility: 'PRIVATE',
      status: params.status ?? PROJECT_STATUS.ACTIVE,
      ttlDays: 90,
      expireAt: params.expireAt,
      purgeAt: params.purgeAt ?? null,
      exemptExpire: params.exemptExpire ?? false,
      authorId: LOCAL_DEMO_USER_ID,
      stats: { create: {} },
    },
    select: { id: true },
  });
  return row.id;
}

/** 读一条作品的关键状态字段。 */
async function readState(slug: string) {
  return prisma.project.findUnique({
    where: { slug },
    select: { id: true, status: true, archivedAt: true, purgeAt: true, expireAt: true, title: true, sizeBytes: true },
  });
}

/** 目录是否存在。 */
async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true).catch(() => false);
}

before(async () => {
  await ensureDataSkeleton();
  await prisma.user.upsert({
    where: { id: LOCAL_DEMO_USER_ID },
    update: {},
    create: { id: LOCAL_DEMO_USER_ID, nickname: '本地创作者' },
  });
  // 清理上一次可能残留的测试数据
  const stale = await prisma.project.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  if (stale.length > 0) {
    await prisma.cleanupLog.deleteMany({ where: { projectId: { in: stale.map((s) => s.id) } } });
    await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  }
});

after(async () => {
  const rows = await prisma.project.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true, slug: true } });
  await prisma.cleanupLog.deleteMany({ where: { projectId: { in: rows.map((r) => r.id) } } });
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  for (const row of rows) {
    await fs.rm(resolveProjectDir(row.slug), { recursive: true, force: true });
  }
  await fs.rm(resolveProjectDir(SLUGS.orphan), { recursive: true, force: true });
  await fs.rm(resolveTmpDir(TMP_OLD), { recursive: true, force: true });
  await fs.rm(resolveTmpDir(TMP_NEW), { recursive: true, force: true });
  await prisma.$disconnect();
});

/* ========================================================================== */

describe('lifecycle · archiveExpired（ACTIVE → ARCHIVED）', () => {
  const now = new Date();

  it('准备：3 条作品（已过期 / 未过期 / 豁免过期）', async () => {
    await seedProject({ slug: SLUGS.expired, expireAt: new Date(now.getTime() - 2 * MS_PER_DAY) });
    await seedProject({ slug: SLUGS.fresh, expireAt: new Date(now.getTime() + 30 * MS_PER_DAY) });
    await seedProject({
      slug: SLUGS.exempt,
      expireAt: new Date(now.getTime() - 5 * MS_PER_DAY),
      exemptExpire: true,
    });
    assert.equal((await readState(SLUGS.expired))?.status, PROJECT_STATUS.ACTIVE);
  });

  it('已过期作品 → status=ARCHIVED，archivedAt 落在 now，purgeAt ≈ now + 30d', async () => {
    const report = await archiveExpired(newBatchId(), now);
    assert.ok(report.affected >= 1, `应至少归档 1 条，实际 ${report.affected}`);
    assert.equal(report.failures, 0);

    const row = await readState(SLUGS.expired);
    assert.equal(row?.status, PROJECT_STATUS.ARCHIVED);
    assert.ok(row?.archivedAt, 'archivedAt 必须写入');
    assert.ok(row?.purgeAt, 'purgeAt 必须写入');

    const expectedPurge = now.getTime() + RECYCLE_BIN_DAYS * MS_PER_DAY;
    const drift = Math.abs((row!.purgeAt as Date).getTime() - expectedPurge);
    assert.ok(drift < 5_000, `purgeAt 应为 now + ${RECYCLE_BIN_DAYS} 天，偏差 ${drift}ms`);
  });

  it('归档后磁盘目录**保留**（回收站期内可一键复活）', async () => {
    assert.equal(await exists(resolveProjectDir(SLUGS.expired)), true, '归档不得删文件，否则续期无法复活');
  });

  it('未过期作品不被归档', async () => {
    assert.equal((await readState(SLUGS.fresh))?.status, PROJECT_STATUS.ACTIVE);
  });

  it('exemptExpire=true 的作品永不被归档', async () => {
    assert.equal((await readState(SLUGS.exempt))?.status, PROJECT_STATUS.ACTIVE, '豁免作品被错误归档');
  });

  it('写入 CleanupLog（action=archive，关联 projectId）', async () => {
    const row = await readState(SLUGS.expired);
    const logs = await prisma.cleanupLog.findMany({ where: { projectId: row?.id, action: 'archive' } });
    assert.ok(logs.length >= 1, '归档动作必须留痕');
    assert.equal(logs[0].success, true);
    assert.ok(logs[0].detail?.includes('purgeAt'), `detail 应包含 purgeAt，实际：${logs[0].detail}`);
  });

  it('重复执行幂等：已归档的不会被再次归档', async () => {
    const report = await archiveExpired(newBatchId(), now);
    const stillTest = report.details.filter((d) => d.includes(SLUGS.expired));
    assert.equal(stillTest.length, 0, '已 ARCHIVED 的记录不应再次进入归档候选');
  });
});

describe('lifecycle · purgeArchived（ARCHIVED → PURGED + 物理删除）', () => {
  const now = new Date();

  it('准备：一条 purgeAt 已到期的 ARCHIVED 作品', async () => {
    await seedProject({
      slug: SLUGS.purgeReady,
      expireAt: new Date(now.getTime() - 40 * MS_PER_DAY),
      status: PROJECT_STATUS.ARCHIVED,
      purgeAt: new Date(now.getTime() - MS_PER_DAY),
      bytes: 4096,
    });
    assert.equal(await exists(resolveProjectDir(SLUGS.purgeReady)), true);
  });

  it('purge → 目录物理消失、freedBytes > 0', async () => {
    const report = await purgeArchived(newBatchId(), now);
    assert.ok(report.affected >= 1, '应至少清除 1 条');
    assert.equal(report.failures, 0);
    assert.ok(report.freedBytes >= 4096, `freedBytes 应 ≥ 4096，实际 ${report.freedBytes}`);
    assert.equal(await exists(resolveProjectDir(SLUGS.purgeReady)), false, '文件必须被物理删除');
  });

  it('DB 行保留、状态置 PURGED（短码占位防重用，元数据留档）', async () => {
    const row = await readState(SLUGS.purgeReady);
    assert.ok(row, 'PURGED 后 DB 行必须保留，不能硬删');
    assert.equal(row?.status, PROJECT_STATUS.PURGED);
    assert.equal(row?.title, `QA 生命周期 ${SLUGS.purgeReady}`, '元数据应完整保留');
  });

  it('刚归档（purgeAt 在未来）的作品不会被清除', async () => {
    assert.equal((await readState(SLUGS.expired))?.status, PROJECT_STATUS.ARCHIVED);
    assert.equal(await exists(resolveProjectDir(SLUGS.expired)), true);
  });

  it('写入 CleanupLog（action=purge，freedBytes 记账）', async () => {
    const row = await readState(SLUGS.purgeReady);
    const logs = await prisma.cleanupLog.findMany({ where: { projectId: row?.id, action: 'purge' } });
    assert.ok(logs.length >= 1);
    assert.ok(logs[0].freedBytes > 0, 'freedBytes 必须入账');
  });
});

describe('lifecycle · 顺序保证：同一批次内「刚归档」不会立刻被清除', () => {
  it('runAll 里 archive 先于 purge，且新归档的 purgeAt 在 30 天后', async () => {
    const slug = `${PREFIX}Seq6`;
    const now = new Date();
    await seedProject({ slug, expireAt: new Date(now.getTime() - MS_PER_DAY) });

    const result = await runAll(now);
    const order = result.reports.map((r) => r.action);
    assert.deepEqual(order, ['archive', 'purge', 'tmp-gc', 'orphan-scan'], '任务顺序不可调换');

    const row = await readState(slug);
    assert.equal(row?.status, PROJECT_STATUS.ARCHIVED, '应被归档');
    assert.equal(await exists(resolveProjectDir(slug)), true, '同批次内绝不能被立刻清除');
  });
});

describe('lifecycle · gcTmp 临时目录回收', () => {
  it('超过会话 TTL 的 tmp 目录被回收，新目录保留', async () => {
    const oldDir = resolveTmpDir(TMP_OLD);
    const newDir = resolveTmpDir(TMP_NEW);
    await fs.mkdir(oldDir, { recursive: true });
    await fs.mkdir(newDir, { recursive: true });
    await fs.writeFile(path.join(oldDir, 'merged.bin'), Buffer.alloc(2048));
    await fs.writeFile(path.join(newDir, 'merged.bin'), Buffer.alloc(2048));

    // 把旧目录的 mtime 推到 TTL 之前
    const stale = new Date(Date.now() - UPLOAD_SESSION_TTL_MS - 60_000);
    await fs.utimes(oldDir, stale, stale);

    const report = await gcTmp(newBatchId(), new Date());
    assert.ok(report.affected >= 1, '应至少回收 1 个过期临时目录');
    assert.equal(await exists(oldDir), false, '过期临时目录必须被回收');
    assert.equal(await exists(newDir), true, '未过期临时目录不得误删');
    assert.ok(report.freedBytes >= 2048, `应统计释放字节，实际 ${report.freedBytes}`);
  });

  it('tmp 根目录本身不被删除', async () => {
    assert.equal(await exists(tmpRoot()), true);
  });
});

describe('lifecycle · scanOrphans 孤儿目录巡检（只报告不删除）', () => {
  it('磁盘有目录但库里没记录 → 报告但不删', async () => {
    const dir = resolveProjectDir(SLUGS.orphan);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), 'orphan');

    const report = await scanOrphans(newBatchId());
    assert.ok(
      report.details.some((d) => d.includes(SLUGS.orphan)),
      `应报告孤儿目录 ${SLUGS.orphan}，实际：${JSON.stringify(report.details)}`,
    );
    assert.equal(await exists(dir), true, 'P0 明确只报告不删除，误删用户作品代价过高');
  });

  it('PURGED 作品残留的目录也算孤儿', async () => {
    // purgeReady 已被物理删除，因此不会再出现在磁盘列表里 —— 这里验证不会误报
    const report = await scanOrphans(newBatchId());
    assert.equal(
      report.details.some((d) => d.includes(SLUGS.purgeReady)),
      false,
      '已清除的作品目录不存在，不应被报告',
    );
  });
});

describe('lifecycle · runAll 汇总', () => {
  it('返回 batchId、四份报告与合计数字', async () => {
    const result = await runAll(new Date());
    assert.match(result.batchId, /^[0-9a-f-]{36}$/, 'batchId 应为 uuid');
    assert.equal(result.reports.length, 4);
    assert.ok(result.durationMs >= 0);
    const sum = result.reports.reduce((acc, r) => acc + r.affected, 0);
    assert.equal(result.totals.affected, sum, '合计数字应与各报告一致');
  });
});
