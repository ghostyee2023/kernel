/**
 * 演示数据播种 —— CLI 薄壳。
 *
 * 逻辑已拆到 `prisma/seed-data.ts`（`runSeed(prisma)`），供 CLI 与
 * Vercel Cron 自动 seed 复用（docs/P0-Vercel试验部署设计.md §1.4 / Q8）。
 *
 * 双模式：`createPrismaClient()` 按 DATABASE_URL 判定 —— 本地 file: 原生引擎；
 * libsql: 走 Turso adapter（此时素材落盘走 Blob，见 storage.ts）。
 *
 * 运行：`npm run db:seed`
 */

import { createPrismaClient } from '../src/lib/prisma';
import { runSeed } from './seed-data';

const prisma = createPrismaClient();

main()
  .catch((error: unknown) => {
    console.error('[seed][fatal]', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

async function main(): Promise<void> {
  await runSeed(prisma);
}
