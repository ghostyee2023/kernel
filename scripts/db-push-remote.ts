/**
 * 生产模式 schema push（Turso / libsql）—— Vercel 试验部署。
 *
 * 用法：
 *   DATABASE_URL="libsql://{db-name}-{org}.turso.io" TURSO_AUTH_TOKEN="eyJ..." npm run db:push-remote
 *
 * 原理（docs/P0-Vercel试验部署设计.md §1.1 / §7.2）：
 *   Prisma Migrate / db push 需要本地 SQLite，无法直接打远端，因此：
 *     1) `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`
 *        产出 DDL（纯 WASM，不起子进程，与 db-init 降级路径同源）；
 *     2) 写入 `prisma/migration-remote.sql`；
 *     3) 若本机装有 `turso` CLI，自动执行 `turso db shell {db-name} < migration.sql`；
 *        否则打印指引（Turso Dashboard SQL 面板粘贴执行亦可）。
 *
 * schema 仍是唯一真源；本脚本可重复执行（DDL 幂等：IF NOT EXISTS / CREATE 前先删）。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** 仓库根目录。 */
const ROOT = process.cwd();
/** prisma CLI 入口（绕开 node_modules/.bin，兼容 --ignore-scripts 安装）。 */
const PRISMA_CLI = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
/** schema 文件路径。 */
const SCHEMA = path.join(ROOT, 'prisma', 'schema.prisma');
/** DDL 输出文件。 */
const OUT_FILE = path.join(ROOT, 'prisma', 'migration-remote.sql');

/** 以子进程方式调用 prisma CLI。 */
function runPrisma(args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** 从 libsql URL 解析 db-name（`libsql://{db-name}-{org}.turso.io`）。 */
function parseDbName(url: string): string {
  const host = url.replace(/^libsql:\/\//, '').split('/')[0] ?? '';
  // Turso 库名 = host 中最后一个 `-` 之前的部分（org 名常含 `-`，故取最后一段）
  const lastDash = host.lastIndexOf('-');
  return lastDash > 0 ? host.slice(0, lastDash) : host;
}

/** 入口。 */
function main(): void {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl.startsWith('libsql:')) {
    console.error('[db:push-remote] 仅生产模式可用：请先设置 DATABASE_URL=libsql://{db-name}-{org}.turso.io');
    process.exit(2);
  }
  if (!process.env.TURSO_AUTH_TOKEN) {
    console.error('[db:push-remote] 缺少 TURSO_AUTH_TOKEN（turso db tokens create {db-name}）');
    process.exit(2);
  }

  console.log('[db:push-remote] 步骤 1/3：migrate diff 产出 DDL…');
  const diff = runPrisma(['migrate', 'diff', '--from-empty', '--to-schema-datamodel', SCHEMA, '--script']);
  if (diff.code !== 0 || diff.stdout.trim() === '') {
    console.error('[db:push-remote] 生成 DDL 失败：');
    console.error(diff.stderr || diff.stdout);
    process.exit(1);
  }

  fs.writeFileSync(OUT_FILE, diff.stdout, 'utf8');
  console.log(`[db:push-remote] 步骤 2/3：DDL 已写入 ${OUT_FILE}（${diff.stdout.split(';').length - 1} 条语句）`);

  const dbName = parseDbName(databaseUrl);
  console.log(`[db:push-remote] 步骤 3/3：应用 DDL 到 Turso（db-name=${dbName}）…`);

  // 若 turso CLI 可用则自动应用；否则打印指引
  const which = spawnSync('turso', ['--version'], { encoding: 'utf8' });
  if (which.status === 0) {
    const apply = spawnSync('turso', ['db', 'shell', dbName], {
      cwd: ROOT,
      input: diff.stdout,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    if (apply.status === 0) {
      console.log('[db:push-remote] 已通过 turso CLI 应用 DDL ✔');
    } else {
      console.error('[db:push-remote] turso CLI 执行失败（可手动应用）：');
      console.error(apply.stderr || apply.stdout);
      printManual(dbName);
    }
  } else {
    console.warn('[db:push-remote] 未检测到 turso CLI，请手动应用：');
    printManual(dbName);
  }
}

/** 打印手动应用指引。 */
function printManual(dbName: string): void {
  console.log('');
  console.log('  方式 A（Turso CLI）：');
  console.log(`    turso db shell ${dbName} < prisma/migration-remote.sql`);
  console.log('  方式 B（Turso Dashboard）：');
  console.log('    打开数据库的 SQL 面板，粘贴 prisma/migration-remote.sql 全文执行');
  console.log('');
  console.log('  应用后验证：SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'Project\';');
}

main();
