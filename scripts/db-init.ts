/**
 * 建库脚本（本地桩）。
 *
 * 用法：
 *   npm run db:init            建表（已存在则跳过）
 *   npm run db:init -- --force 删库重建
 *
 * 为什么不是直接 `prisma db push`：
 *   `db push` 依赖 `schema-engine-*.exe` 子进程。部分受限环境（沙箱 / 无子进程权限的 CI）
 *   下该子进程无法启动，报 `Schema engine error:` 且无详情。
 *   本脚本先尝试标准 `db push`，失败时降级为：
 *     `prisma migrate diff`（纯 WASM，不起子进程）产出 DDL → 经 Prisma Client 的
 *     query engine（.node 原生插件，同样不起子进程）执行。
 *   两条路径的 DDL 都由 `prisma/schema.prisma` 生成，**schema 仍是唯一真源**。
 *
 * ⬆️ 切生产：直接用 `prisma migrate deploy`，删除本文件。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

/** 仓库根目录。 */
const ROOT = process.cwd();
/** prisma CLI 入口（绕开 node_modules/.bin，兼容 --ignore-scripts 安装）。 */
const PRISMA_CLI = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
/** schema 文件路径。 */
const SCHEMA = path.join(ROOT, 'prisma', 'schema.prisma');
/** SQLite 数据库文件路径（与 .env 的 `file:./dev.db` 对应）。 */
const DB_FILE = path.join(ROOT, 'prisma', 'dev.db');

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

/**
 * 重新生成 Prisma Client（@prisma/client 的 postinstall 只在安装时跑一次，
 * schema 变更后必须手动 generate，否则 seed / 服务端代码拿不到新模型）。
 * 失败视为致命 —— seed 依赖新 client。
 */
function generateClient(): void {
  const result = runPrisma(['generate']);
  if (result.code !== 0) {
    console.error('[db:init] prisma generate 失败：');
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }
  console.log('[db:init] prisma generate 成功');
}

/**
 * 把 DDL 脚本切成单条语句。
 *
 * Prisma 产出的 SQLite DDL 不含字符串字面量里的分号，按 `;` 切分是安全的；
 * 注释行（`--`）单独剔除，避免空语句。
 */
function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((stmt) => stmt !== '');
}

/** 通过 query engine 执行 DDL。 */
async function applySql(sql: string): Promise<number> {
  const statements = splitStatements(sql);
  const prisma = new PrismaClient();
  try {
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }
  } finally {
    await prisma.$disconnect();
  }
  return statements.length;
}

/** 判断核心表是否已存在。 */
async function tablesExist(): Promise<boolean> {
  if (!fs.existsSync(DB_FILE)) return false;
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Project'`,
    );
    return rows.length > 0;
  } catch {
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

/** 入口。 */
async function main(): Promise<void> {
  // Vercel 试验部署守卫（docs/P0-Vercel试验部署设计.md §1.1）：
  // 本脚本是本地专用（操作 prisma/dev.db）；libsql: 远端请用 db:push-remote。
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (databaseUrl.startsWith('libsql:')) {
    console.error('[db:init] DATABASE_URL 以 libsql: 开头 —— 本脚本为本地专用（SQLite dev.db）。');
    console.error('  远端 schema 应用请用：npm run db:push-remote（migrate diff 产出 DDL → turso db shell 应用）');
    process.exit(2);
  }

  const force = process.argv.includes('--force');

  if (force && fs.existsSync(DB_FILE)) {
    fs.rmSync(DB_FILE, { force: true });
    fs.rmSync(`${DB_FILE}-journal`, { force: true });
    console.log('[db:init] 已删除旧的 dev.db');
  }

  if (!force && (await tablesExist())) {
    console.log('[db:init] 表结构已存在，跳过（需重建请加 --force）');
    return;
  }

  /* ---------- 路径 A：标准 db push ---------- */
  const push = runPrisma(['db', 'push', '--skip-generate', '--accept-data-loss']);
  if (push.code === 0) {
    console.log('[db:init] prisma db push 成功');
    generateClient();
    return;
  }
  console.warn('[db:init] prisma db push 不可用（schema engine 未能启动），降级为 DDL 直连模式');

  /* ---------- 路径 B：migrate diff + 直连执行 ---------- */
  const diff = runPrisma([
    'migrate',
    'diff',
    '--from-empty',
    '--to-schema-datamodel',
    SCHEMA,
    '--script',
  ]);
  if (diff.code !== 0 || diff.stdout.trim() === '') {
    console.error('[db:init] 生成 DDL 失败：');
    console.error(diff.stderr || diff.stdout);
    process.exit(1);
  }

  const count = await applySql(diff.stdout);
  console.log(`[db:init] 已执行 ${count} 条 DDL，数据库就绪：${DB_FILE}`);
  generateClient();
}

main().catch((error) => {
  console.error('[db:init] 执行失败', error);
  process.exit(1);
});
