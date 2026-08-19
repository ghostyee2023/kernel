/**
 * db-sync-remote.mjs —— 线上 Turso 库幂等 schema 同步（构建时自动执行）。
 *
 * 背景：Vercel 云构建会注入 Production 环境变量（DATABASE_URL=libsql://… + TURSO_AUTH_TOKEN），
 * 但 @prisma/client 的 postinstall 可能被 npm allow-scripts 拦截导致 client 陈旧；
 * 且线上库可能缺新列（本地 db push 只影响 dev.db）。
 *
 * 职责：通过 libsql HTTP API（v2/pipeline）检查 User / Campaign 表，
 * 缺列则 ALTER TABLE ADD COLUMN（带默认值，零数据风险），已存在则跳过 → 幂等。
 * 非 Turso 模式（本地 dev）直接跳过。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 兼容 Vercel 构建（env 已注入）与本地手动执行（--env-file=.env.production）
if (!process.env.DATABASE_URL && fs.existsSync(path.join(__dirname, '..', '.env.production'))) {
  const lines = fs
    .readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8')
    .split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const dbUrl = process.env.DATABASE_URL ?? '';
const token = process.env.TURSO_AUTH_TOKEN ?? '';

if (!dbUrl.startsWith('libsql:')) {
  console.log('[db-sync-remote] 非 Turso 模式（DATABASE_URL=' + dbUrl.slice(0, 12) + '…），跳过 schema 同步');
  process.exit(0);
}
if (!token) {
  console.warn('[db-sync-remote] 缺少 TURSO_AUTH_TOKEN，跳过 schema 同步（线上库可能缺新列）');
  process.exit(0);
}

const host = dbUrl.replace('libsql://', 'https://');

/** 执行单条 SQL，返回行数组。 */
async function exec(sql) {
  const res = await fetch(host + '/v2/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }] }),
  });
  const json = await res.json();
  if (json.error) throw new Error('[db-sync-remote] pipeline: ' + JSON.stringify(json.error));
  const first = json.results?.[0];
  if (!first) throw new Error('[db-sync-remote] 无结果');
  if (first.type === 'error') throw new Error('[db-sync-remote] stmt: ' + JSON.stringify(first.error));
  return first.response?.result?.rows ?? [];
}

/** 查表全部列名（pragma_table_info 表值函数，libsql HTTP 下兼容性优于 PRAGMA 语句）。 */
async function columns(table) {
  const rows = await exec("SELECT name FROM pragma_table_info('" + table + "')");
  return rows.map((r) => r[0]);
}

/** 查表是否存在（sqlite_master，比 pragma_table_info 更可靠）。 */
async function tableExists(table) {
  const rows = await exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='" + table + "'");
  return rows.length > 0;
}

/**
 * 缺失的新表（CREATE TABLE IF NOT EXISTS 天然幂等；与 prisma/schema.prisma 对齐）。
 * 仅当表不存在时执行（后续 ALTER 列逻辑仍按需补列）。
 */
const TABLES = [
  {
    name: 'Tag',
    ddl: [
      'CREATE TABLE IF NOT EXISTS "Tag" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT \'custom\', "activityId" TEXT, "sortOrder" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "Tag_pkey" PRIMARY KEY ("id"))',
      'CREATE UNIQUE INDEX IF NOT EXISTS "Tag_name_key" ON "Tag"("name")',
      'CREATE UNIQUE INDEX IF NOT EXISTS "Tag_slug_key" ON "Tag"("slug")',
      'CREATE UNIQUE INDEX IF NOT EXISTS "Tag_activityId_key" ON "Tag"("activityId")',
      'CREATE INDEX IF NOT EXISTS "Tag_sortOrder_idx" ON "Tag"("sortOrder")',
    ],
  },
  {
    name: 'ProjectTag',
    ddl: [
      'CREATE TABLE IF NOT EXISTS "ProjectTag" ("projectId" TEXT NOT NULL, "tagId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ProjectTag_pkey" PRIMARY KEY ("projectId","tagId"))',
      'CREATE INDEX IF NOT EXISTS "ProjectTag_tagId_idx" ON "ProjectTag"("tagId")',
    ],
  },
];

/** 目标增量（只增不改不删；默认值与 Prisma schema 一致）。 */
const ALTERS = [
  { table: 'User', col: 'riskLevel', ddl: 'ALTER TABLE User ADD COLUMN riskLevel INTEGER NOT NULL DEFAULT 0' },
  { table: 'Campaign', col: 'resultVisible', ddl: 'ALTER TABLE Campaign ADD COLUMN resultVisible BOOLEAN NOT NULL DEFAULT 1' },
  { table: 'Campaign', col: 'activityType', ddl: "ALTER TABLE Campaign ADD COLUMN activityType TEXT NOT NULL DEFAULT 'ONLINE'" },
  { table: 'Project', col: 'screenshots', ddl: "ALTER TABLE Project ADD COLUMN screenshots TEXT NOT NULL DEFAULT '[]'" },
];

let added = 0;
let failed = 0;
// 先建缺失的表（CREATE TABLE IF NOT EXISTS 幂等）
for (const t of TABLES) {
  try {
    const exists = await tableExists(t.name);
    if (exists) {
      console.log('[db-sync-remote] = 表', t.name, '已存在');
      continue;
    }
    // 逐条执行 DDL（多条一次 pipeline）
    const res = await fetch(host + '/v2/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: t.ddl.map((sql) => ({ type: 'execute', stmt: { sql } })) }),
    });
    const json = await res.json();
    if (json.error) throw new Error('[db-sync-remote] pipeline: ' + JSON.stringify(json.error));
    const err = json.results?.find((r) => r.type === 'error');
    if (err) throw new Error('[db-sync-remote] stmt: ' + JSON.stringify(err.error));
    console.log('[db-sync-remote] + 建表', t.name);
    added++;
  } catch (err) {
    failed++;
    console.warn(`[db-sync-remote] 跳过建表 ${t.name}:`, err.message);
  }
}
// 逐列独立容错：单列失败只告警，不中断后续列（避免「一列误判阻断全表」）
for (const a of ALTERS) {
  try {
    const cols = await columns(a.table);
    if (cols.includes(a.col)) {
      console.log('[db-sync-remote] =', a.table + '.' + a.col, '已存在');
    } else {
      await exec(a.ddl);
      console.log('[db-sync-remote] +', a.table + '.' + a.col);
      added++;
    }
  } catch (err) {
    failed++;
    console.warn(`[db-sync-remote] 跳过 ${a.table}.${a.col}:`, err.message);
  }
}
console.log(`[db-sync-remote] schema 同步完成（新增 ${added} 项，跳过 ${failed} 项）`);
