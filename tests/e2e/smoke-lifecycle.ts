/**
 * 阶段 D-4 端到端：生命周期 ACTIVE → ARCHIVED → PURGED 流转。
 *
 * 步骤（每步之间通过外部 `npm run cleanup:once` 推进，本脚本负责夹具与断言）：
 *   phase=arm-archive   把目标作品 expireAt 推到过去
 *   phase=check-archive 断言已归档 + purgeAt≈archivedAt+30d + 磁盘仍在 + 路由表现
 *   phase=arm-purge     把 purgeAt 推到过去
 *   phase=check-purge   断言已清除 + 磁盘物理删除 + 元数据保留 + CleanupLog 留痕
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = process.env.QA_BASE_URL ?? 'http://localhost:3111';
const DATA_ROOT = path.resolve(process.cwd(), process.env.KERNEL_DATA_DIR ?? './.kernel-data');

const slug = process.env.QA_SLUG ?? '';
const phase = process.argv[2] ?? '';

const DAY = 24 * 60 * 60 * 1000;

function dir(): string {
  return path.join(DATA_ROOT, 'projects', slug);
}

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      results.push({ name, ok: true, detail: '' });
      console.log(`  PASS  ${name}`);
    })
    .catch((e) => {
      const detail = e instanceof Error ? e.message.split('\n')[0] : String(e);
      results.push({ name, ok: false, detail });
      console.log(`  FAIL  ${name}\n        ${detail}`);
    });
}

async function main() {
  assert.ok(slug, '必须通过 QA_SLUG 指定目标 slug');

  if (phase === 'arm-archive') {
    const before = await prisma.project.findUniqueOrThrow({ where: { slug } });
    console.log(
      `[arm] ${slug} status=${before.status} expireAt=${before.expireAt.toISOString()} 文件数=${readdirSync(dir()).length}`,
    );
    await prisma.project.update({
      where: { slug },
      data: { expireAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    console.log(`[arm] expireAt 已推到 1 小时前，等待 cleanup 归档`);
    return;
  }

  if (phase === 'check-archive') {
    const p = await prisma.project.findUniqueOrThrow({ where: { slug } });
    console.log(
      `[check] status=${p.status} archivedAt=${p.archivedAt?.toISOString()} purgeAt=${p.purgeAt?.toISOString()}`,
    );

    await check('status 变为 ARCHIVED', () => assert.equal(p.status, 'ARCHIVED'));
    await check('archivedAt 已写入', () => assert.ok(p.archivedAt instanceof Date));
    await check('purgeAt ≈ archivedAt + 30 天（误差 < 5 分钟）', () => {
      assert.ok(p.purgeAt && p.archivedAt);
      const delta = Math.abs(p.purgeAt.getTime() - (p.archivedAt.getTime() + 30 * DAY));
      assert.ok(delta < 5 * 60 * 1000, `delta=${delta}ms`);
    });
    await check('归档阶段磁盘文件仍保留（回收站语义）', () => {
      assert.ok(existsSync(dir()), `目录已消失：${dir()}`);
      assert.ok(readdirSync(dir()).length > 0);
    });
    // 设计约定（sandbox route 头注释）：ARCHIVED → 302 跳 /_status/{slug} 友好落地页，
    // 而不是直接 404 —— 用户还有 30 天可以一键续期。
    await check('归档后沙箱不再直出内容，302 跳状态页', async () => {
      const r = await fetch(`${BASE}/sandbox/${slug}`, { redirect: 'manual' });
      assert.equal(r.status, 302, `status=${r.status}`);
      assert.match(r.headers.get('location') ?? '', /\/_status\/BEieXvj3$|\/_status\//);
    });
    await check('状态页可渲染归档信息（回收站/恢复/续期）', async () => {
      const r = await fetch(`${BASE}/_status/${slug}`);
      const html = await r.text();
      assert.equal(r.status, 200);
      assert.ok(html.includes('回收站'), '状态页缺少回收站文案');
      assert.ok(html.includes('已归档'), '状态页缺少已归档标识');
    });
    await check('归档后不再出现在广场列表', async () => {
      const r = await fetch(`${BASE}/api/projects?pageSize=100`);
      const j = (await r.json()) as any;
      const slugs = (j.data ?? []).map((x: any) => x.slug);
      assert.ok(!slugs.includes(slug), `列表仍含 ${slug}`);
    });
    await check('CleanupLog 有 archive 留痕', async () => {
      const logs = await prisma.cleanupLog.findMany({ where: { action: 'archive' } });
      assert.ok(logs.length > 0, 'archive 日志为空');
    });
    summarize();
    return;
  }

  if (phase === 'arm-purge') {
    await prisma.project.update({
      where: { slug },
      data: { purgeAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    console.log(`[arm] purgeAt 已推到 1 小时前，等待 cleanup 清除`);
    return;
  }

  if (phase === 'check-purge') {
    const p = await prisma.project.findUnique({ where: { slug } });
    console.log(`[check] row=${p ? 'exists' : 'null'} status=${p?.status} dirExists=${existsSync(dir())}`);

    await check('元数据行保留（不硬删）', () => assert.ok(p, '数据库行被物理删除了'));
    await check('status 变为 PURGED', () => assert.equal(p?.status, 'PURGED'));
    await check('磁盘目录已物理删除', () => assert.ok(!existsSync(dir()), `目录仍在：${dir()}`));
    await check('清除后短链返回 404', async () => {
      const r = await fetch(`${BASE}/sandbox/${slug}`, { redirect: 'manual' });
      assert.equal(r.status, 404, `status=${r.status}`);
    });
    await check('CleanupLog 有 purge 留痕且释放字节 > 0', async () => {
      const logs = await prisma.cleanupLog.findMany({ where: { action: 'purge' } });
      assert.ok(logs.length > 0, 'purge 日志为空');
      assert.ok(
        logs.some((l) => l.freedBytes > 0),
        `freedBytes 全为 0：${JSON.stringify(logs.map((l) => l.freedBytes))}`,
      );
    });
    summarize();
    return;
  }

  console.error(`未知 phase：${phase}`);
  process.exitCode = 2;
}

function summarize() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n----- ${phase}：${results.length - failed.length}/${results.length} 通过 -----`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('LIFECYCLE_CRASHED:', e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
