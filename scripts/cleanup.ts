/**
 * 一次性生命周期清理。
 *
 * 用法：
 *   npm run cleanup:once
 *   npm run cleanup:once -- --dry-run     仅打印将要处理的对象，不落库不删盘
 *   npm run cleanup:once -- --at=2026-01-01T00:00:00Z   注入「现在」，用于演示过期
 *
 * 退出码：0 全部成功；1 存在失败项（便于挂到 CI / 定时器告警）。
 */

import { runAll } from '../src/lib/lifecycle';
import { prisma } from '../src/lib/prisma';
import { formatBytes } from '../src/lib/format';
import { PROJECT_STATUS } from '../src/lib/constants';

/** 解析命令行参数。 */
function parseArgs(argv: string[]): { dryRun: boolean; at: Date } {
  const dryRun = argv.includes('--dry-run');
  const atArg = argv.find((a) => a.startsWith('--at='));
  let at = new Date();
  if (atArg) {
    const parsed = new Date(atArg.slice('--at='.length));
    if (Number.isNaN(parsed.getTime())) {
      console.error(`[cleanup] --at 不是合法时间：${atArg}`);
      process.exit(2);
    }
    at = parsed;
  }
  return { dryRun, at };
}

/** 干跑：只查询、只打印，不做任何写操作。 */
async function dryRun(at: Date): Promise<void> {
  const [toArchive, toPurge] = await Promise.all([
    prisma.project.findMany({
      where: { status: PROJECT_STATUS.ACTIVE, exemptExpire: false, expireAt: { lte: at } },
      select: { slug: true, title: true, expireAt: true },
      orderBy: { expireAt: 'asc' },
    }),
    prisma.project.findMany({
      where: { status: PROJECT_STATUS.ARCHIVED, purgeAt: { lte: at } },
      select: { slug: true, title: true, purgeAt: true, sizeBytes: true },
      orderBy: { purgeAt: 'asc' },
    }),
  ]);

  console.log(`\n=== DRY RUN @ ${at.toISOString()} ===`);
  console.log(`\n[将归档] ${toArchive.length} 件`);
  for (const p of toArchive) {
    console.log(`  - ${p.slug}  ${p.title}  expireAt=${p.expireAt.toISOString()}`);
  }
  console.log(`\n[将清除] ${toPurge.length} 件`);
  for (const p of toPurge) {
    console.log(
      `  - ${p.slug}  ${p.title}  purgeAt=${p.purgeAt?.toISOString() ?? '-'}  ${formatBytes(p.sizeBytes)}`,
    );
  }
  console.log('\n（dry-run 不做任何写操作）\n');
}

/** 入口。 */
async function main(): Promise<void> {
  const { dryRun: isDry, at } = parseArgs(process.argv.slice(2));

  if (isDry) {
    await dryRun(at);
    return;
  }

  const result = await runAll(at);

  console.log(`\n=== Kernel 生命周期清理 ===`);
  console.log(`批次：${result.batchId}`);
  console.log(`耗时：${result.durationMs}ms\n`);

  for (const report of result.reports) {
    console.log(
      `[${report.action}] 扫描 ${report.scanned} / 处理 ${report.affected} / 失败 ${report.failures} / 释放 ${formatBytes(report.freedBytes)}`,
    );
    for (const detail of report.details) {
      console.log(`    · ${detail}`);
    }
  }

  console.log(
    `\n合计：处理 ${result.totals.affected} 项，释放 ${formatBytes(result.totals.freedBytes)}，失败 ${result.totals.failures} 项\n`,
  );

  if (result.totals.failures > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('[cleanup] 执行失败', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
