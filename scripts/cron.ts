/**
 * 常驻定时清理进程（本地桩替代 BullMQ repeatable job）。
 *
 * 用法：
 *   npm run cleanup:cron
 *   CLEANUP_CRON="*\/5 * * * *" npm run cleanup:cron   自定义频率
 *
 * 行为：
 *   - 默认每小时第 0 分执行一次 `runAll()`；
 *   - 单例锁：上一轮未结束时跳过本轮，避免重入把同一批作品处理两次；
 *   - 收到 SIGINT / SIGTERM 时优雅退出（等待在途任务结束后断开 prisma）。
 *
 * ⬆️ 切生产：删除本文件，改用 BullMQ `repeat: { pattern }`，runAll() 原样复用。
 *
 * ⬆️ Vercel 试验部署（docs/P0-Vercel试验部署设计.md §1.4 / §7.1）：
 *   `NODE_ENV=production` 时进程内 cron 直接退出（Vercel 无常驻进程，
 *   调度走 vercel.json + /api/cron/run HTTP 端点），双保险防误启。
 */

import cron from 'node-cron';

import { formatBytes } from '../src/lib/format';
import { runAll } from '../src/lib/lifecycle';
import { prisma } from '../src/lib/prisma';

/** 默认每小时整点执行。 */
const DEFAULT_PATTERN = '0 * * * *';

/** 单例锁：防止上一轮未结束时重入。 */
let running = false;
/** 是否已收到退出信号。 */
let shuttingDown = false;

/** 执行一轮清理并打印摘要。 */
async function tick(): Promise<void> {
  if (running) {
    console.warn('[cron] 上一轮尚未结束，跳过本轮');
    return;
  }
  running = true;
  try {
    const result = await runAll();
    console.log(
      `[cron] batch=${result.batchId} 处理 ${result.totals.affected} 项 / 释放 ${formatBytes(result.totals.freedBytes)} / 失败 ${result.totals.failures} 项 / ${result.durationMs}ms`,
    );
  } catch (error) {
    console.error('[cron] 本轮执行失败', error);
  } finally {
    running = false;
  }
}

/** 入口。 */
function main(): void {
  // Vercel 试验部署守卫：生产环境禁用进程内 cron（调度走 Vercel Cron /api/cron/run）
  if (process.env.NODE_ENV === 'production') {
    console.warn('[cron] NODE_ENV=production：进程内 cron 已禁用，请用 Vercel Cron 触发 /api/cron/run');
    process.exit(0);
  }

  const pattern = process.env.CLEANUP_CRON?.trim() || DEFAULT_PATTERN;

  if (!cron.validate(pattern)) {
    console.error(`[cron] CLEANUP_CRON 不是合法的 cron 表达式：${pattern}`);
    process.exit(2);
  }

  const task = cron.schedule(pattern, () => {
    void tick();
  });

  console.log(`[cron] 生命周期守护已启动，pattern="${pattern}"（Ctrl+C 退出）`);
  // 启动即跑一次，避免本地演示要等到下一个整点
  void tick();

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[cron] 收到 ${signal}，停止调度…`);
    task.stop();

    // 等待在途任务收尾，最多 30s
    const deadline = Date.now() + 30_000;
    while (running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    await prisma.$disconnect();
    console.log('[cron] 已优雅退出');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main();
