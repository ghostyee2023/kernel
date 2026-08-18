/**
 * 生命周期任务：过期归档 → 回收站清除 → 临时目录回收 → 孤儿目录巡检。
 *
 * 设计真源：docs/P0-架构与任务分解.md §3.4、docs/sequence-diagram.mermaid「自动过期」。
 *
 * 本地桩形态：
 *   - 无 BullMQ / Redis，四个任务都是纯函数，可被 `scripts/cleanup.ts`（一次性）
 *     或 `scripts/cron.ts`（node-cron 常驻）或 `POST /api/admin/cleanup/run` 调用；
 *   - 每次运行生成一个 `batchId`，全部动作写入 CleanupLog 便于回溯；
 *   - 单条失败不阻断整批（逐条 try/catch），失败计入 `failures`。
 *
 * ⬆️ 切生产：把 `runAll()` 挂到 BullMQ repeatable job，本文件逻辑零改动。
 */

import { randomUUID } from 'node:crypto';

import {
  CLEANUP_ACTION,
  CLEANUP_BATCH_SIZE,
  PROJECT_STATUS,
  RECYCLE_BIN_DAYS,
  UPLOAD_SESSION_TTL_MS,
  type CleanupAction,
} from './constants';
import { MS_PER_DAY } from './format';
import { prisma } from './prisma';
import {
  dirSize,
  ensureDataSkeleton,
  listProjectSlugs,
  listTmpDirs,
  removeProjectDir,
  removeTmpDir,
  resolveProjectDir,
  resolveTmpDir,
} from './storage';
import type { CleanupReport } from './types';

/* ============================================================================
   0) 通用工具
   ========================================================================== */

/** 生成一次任务运行的批次 id。 */
export function newBatchId(): string {
  return randomUUID();
}

/** 空报告骨架。 */
function emptyReport(batchId: string, action: CleanupAction): CleanupReport {
  return {
    batchId,
    action,
    scanned: 0,
    affected: 0,
    freedBytes: 0,
    failures: 0,
    details: [],
    durationMs: 0,
  };
}

/**
 * 写一条 CleanupLog。日志失败不能影响主流程，仅告警。
 */
async function writeLog(params: {
  batchId: string;
  action: CleanupAction;
  projectId?: string | null;
  freedBytes?: number;
  success?: boolean;
  message?: string;
  detail?: unknown;
}): Promise<void> {
  try {
    await prisma.cleanupLog.create({
      data: {
        batchId: params.batchId,
        action: params.action,
        projectId: params.projectId ?? null,
        freedBytes: params.freedBytes ?? 0,
        success: params.success ?? true,
        message: params.message ?? null,
        // Json → String 降级：调用点只管传对象，序列化收敛在这里
        detail: params.detail === undefined ? null : JSON.stringify(params.detail),
      },
    });
  } catch (error) {
    console.warn(`[lifecycle][log] 写入 CleanupLog 失败 action=${params.action}`, error);
  }
}

/* ============================================================================
   1) 过期归档：ACTIVE 且 expireAt <= now → ARCHIVED
   ========================================================================== */

/**
 * 把已到期的 ACTIVE 作品归档，并设置 30 天后的 purgeAt。
 *
 * 磁盘目录**不删除**，用户仍可在状态页一键续期复活。
 * `exemptExpire = true` 的作品（活动获奖等）永不归档。
 *
 * @param now 注入当前时间，便于测试。
 */
export async function archiveExpired(batchId: string, now: Date = new Date()): Promise<CleanupReport> {
  const started = Date.now();
  const report = emptyReport(batchId, CLEANUP_ACTION.ARCHIVE);

  const candidates = await prisma.project.findMany({
    where: {
      status: PROJECT_STATUS.ACTIVE,
      exemptExpire: false,
      expireAt: { lte: now },
    },
    select: { id: true, slug: true, title: true, expireAt: true },
    orderBy: { expireAt: 'asc' },
    take: CLEANUP_BATCH_SIZE,
  });
  report.scanned = candidates.length;

  for (const item of candidates) {
    try {
      const purgeAt = new Date(now.getTime() + RECYCLE_BIN_DAYS * MS_PER_DAY);
      await prisma.project.update({
        where: { id: item.id },
        data: { status: PROJECT_STATUS.ARCHIVED, archivedAt: now, purgeAt },
      });
      report.affected += 1;
      report.details.push(`归档 ${item.slug}（${item.title}），${RECYCLE_BIN_DAYS} 天后清除`);
      await writeLog({
        batchId,
        action: CLEANUP_ACTION.ARCHIVE,
        projectId: item.id,
        message: `expireAt=${item.expireAt.toISOString()}`,
        detail: { slug: item.slug, purgeAt: purgeAt.toISOString() },
      });
    } catch (error) {
      report.failures += 1;
      report.details.push(`归档失败 ${item.slug}：${(error as Error).message}`);
      await writeLog({
        batchId,
        action: CLEANUP_ACTION.ARCHIVE,
        projectId: item.id,
        success: false,
        message: (error as Error).message,
      });
    }
  }

  report.durationMs = Date.now() - started;
  console.log(`[lifecycle][archive] scanned=${report.scanned} affected=${report.affected} failures=${report.failures}`);
  return report;
}

/* ============================================================================
   2) 回收站清除：ARCHIVED 且 purgeAt <= now → PURGED + 删目录
   ========================================================================== */

/**
 * 清除回收站到期的作品：物理删除磁盘目录，DB 行保留但标记 PURGED（保留短码占位，防重用）。
 *
 * @param now 注入当前时间，便于测试。
 */
export async function purgeArchived(batchId: string, now: Date = new Date()): Promise<CleanupReport> {
  const started = Date.now();
  const report = emptyReport(batchId, CLEANUP_ACTION.PURGE);

  const candidates = await prisma.project.findMany({
    where: {
      status: PROJECT_STATUS.ARCHIVED,
      purgeAt: { lte: now },
    },
    select: { id: true, slug: true, title: true, sizeBytes: true },
    orderBy: { purgeAt: 'asc' },
    take: CLEANUP_BATCH_SIZE,
  });
  report.scanned = candidates.length;

  for (const item of candidates) {
    try {
      const freed = await removeProjectDir(item.slug);
      await prisma.project.update({
        where: { id: item.id },
        data: { status: PROJECT_STATUS.PURGED },
      });
      report.affected += 1;
      report.freedBytes += freed;
      report.details.push(`清除 ${item.slug}（${item.title}），释放 ${freed} 字节`);
      await writeLog({
        batchId,
        action: CLEANUP_ACTION.PURGE,
        projectId: item.id,
        freedBytes: freed,
        detail: { slug: item.slug },
      });
    } catch (error) {
      report.failures += 1;
      report.details.push(`清除失败 ${item.slug}：${(error as Error).message}`);
      await writeLog({
        batchId,
        action: CLEANUP_ACTION.PURGE,
        projectId: item.id,
        success: false,
        message: (error as Error).message,
      });
    }
  }

  report.durationMs = Date.now() - started;
  console.log(
    `[lifecycle][purge] scanned=${report.scanned} affected=${report.affected} freed=${report.freedBytes}B failures=${report.failures}`,
  );
  return report;
}

/* ============================================================================
   3) 临时目录回收：tmp/{uploadId} 超过会话 TTL 未提交
   ========================================================================== */

/**
 * 回收超时未提交的上传临时目录。
 *
 * 判据只看目录 mtime，不解析 session.json——即便会话文件损坏也能被回收。
 *
 * @param now 注入当前时间，便于测试。
 */
export async function gcTmp(batchId: string, now: Date = new Date()): Promise<CleanupReport> {
  const started = Date.now();
  const report = emptyReport(batchId, CLEANUP_ACTION.TMP_GC);

  const dirs = await listTmpDirs();
  report.scanned = dirs.length;
  const deadline = now.getTime() - UPLOAD_SESSION_TTL_MS;

  for (const dir of dirs) {
    if (dir.mtimeMs > deadline) continue;
    try {
      const freed = await dirSize(resolveTmpDir(dir.uploadId));
      await removeTmpDir(dir.uploadId);
      report.affected += 1;
      report.freedBytes += freed;
      report.details.push(`回收临时目录 ${dir.uploadId}，释放 ${freed} 字节`);
    } catch (error) {
      report.failures += 1;
      report.details.push(`回收失败 ${dir.uploadId}：${(error as Error).message}`);
    }
  }

  if (report.affected > 0 || report.failures > 0) {
    await writeLog({
      batchId,
      action: CLEANUP_ACTION.TMP_GC,
      freedBytes: report.freedBytes,
      success: report.failures === 0,
      message: `回收 ${report.affected} 个临时目录`,
      detail: { scanned: report.scanned, failures: report.failures },
    });
  }

  report.durationMs = Date.now() - started;
  console.log(`[lifecycle][tmp-gc] scanned=${report.scanned} affected=${report.affected} freed=${report.freedBytes}B`);
  return report;
}

/* ============================================================================
   4) 孤儿目录巡检：磁盘有目录、库里没有对应 ACTIVE/ARCHIVED 记录
   ========================================================================== */

/**
 * 巡检磁盘上的孤儿作品目录。
 *
 * P0 **只报告不删除**——误删用户作品的代价远大于占用几 MB 磁盘。
 * 报告写入 CleanupLog，运维（本地即开发者）确认后手动清理。
 */
export async function scanOrphans(batchId: string): Promise<CleanupReport> {
  const started = Date.now();
  const report = emptyReport(batchId, CLEANUP_ACTION.ORPHAN_SCAN);

  const slugsOnDisk = await listProjectSlugs();
  report.scanned = slugsOnDisk.length;
  if (slugsOnDisk.length === 0) {
    report.durationMs = Date.now() - started;
    return report;
  }

  const rows = await prisma.project.findMany({
    where: { slug: { in: slugsOnDisk } },
    select: { slug: true, status: true },
  });
  const alive = new Set(
    rows.filter((r) => r.status !== PROJECT_STATUS.PURGED).map((r) => r.slug),
  );

  for (const slug of slugsOnDisk) {
    if (alive.has(slug)) continue;
    const size = await dirSize(resolveProjectDir(slug)).catch(() => 0);
    report.affected += 1;
    report.freedBytes += size;
    report.details.push(`孤儿目录 ${slug}（${size} 字节），仅报告未删除`);
  }

  if (report.affected > 0) {
    await writeLog({
      batchId,
      action: CLEANUP_ACTION.ORPHAN_SCAN,
      freedBytes: 0,
      message: `发现 ${report.affected} 个孤儿目录（未删除）`,
      detail: { details: report.details },
    });
  }

  report.durationMs = Date.now() - started;
  console.log(`[lifecycle][orphan-scan] scanned=${report.scanned} orphan=${report.affected}`);
  return report;
}

/* ============================================================================
   5) 编排
   ========================================================================== */

/** 一次完整清理的汇总。 */
export interface CleanupRunResult {
  batchId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  reports: CleanupReport[];
  totals: { scanned: number; affected: number; freedBytes: number; failures: number };
}

/**
 * 顺序执行全部生命周期任务。
 *
 * 顺序不可调换：先归档（产生新的 purgeAt），再清除（消费旧的 purgeAt），
 * 保证同一批次内不会出现「刚归档就被清除」。
 *
 * @param now 注入当前时间，便于测试。
 */
export async function runAll(now: Date = new Date()): Promise<CleanupRunResult> {
  await ensureDataSkeleton();

  const batchId = newBatchId();
  const started = Date.now();
  console.log(`[lifecycle][run] batchId=${batchId} at=${now.toISOString()}`);

  const reports: CleanupReport[] = [];
  reports.push(await archiveExpired(batchId, now));
  reports.push(await purgeArchived(batchId, now));
  reports.push(await gcTmp(batchId, now));
  reports.push(await scanOrphans(batchId));

  const totals = reports.reduce(
    (acc, r) => ({
      scanned: acc.scanned + r.scanned,
      affected: acc.affected + r.affected,
      freedBytes: acc.freedBytes + r.freedBytes,
      failures: acc.failures + r.failures,
    }),
    { scanned: 0, affected: 0, freedBytes: 0, failures: 0 },
  );

  const durationMs = Date.now() - started;
  console.log(
    `[lifecycle][done] batchId=${batchId} affected=${totals.affected} freed=${totals.freedBytes}B in ${durationMs}ms`,
  );

  return {
    batchId,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs,
    reports,
    totals,
  };
}
