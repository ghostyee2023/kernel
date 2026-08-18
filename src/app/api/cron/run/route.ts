/**
 * GET|POST /api/cron/run
 *
 * Vercel Cron 调度端点（docs/P0-Vercel试验部署设计.md §1.4 / §7.4 / §7.5）。
 *
 * 行为（顺序不可调换）：
 *   1. 鉴权（常量时间比较，失败 401）：
 *        - `Authorization: Bearer {CRON_SECRET}` —— **Vercel 平台自动注入**：
 *          只要在项目里配置名为 `CRON_SECRET` 的环境变量，Vercel 发起 cron 请求时
 *          会自动带上该 Bearer 头（官方「Managing Cron Jobs」文档），因此
 *          `vercel.json` 无需（也无法）自定义头。
 *        - `X-Cron-Secret: {CRON_SECRET}` 头（手动 curl 便利）。
 *        - `?secret={CRON_SECRET}` 查询参数（本地验证便利；生产路径保持干净）。
 *        - `x-vercel-cron-schedule` 头**仅作日志标记，不作文鉴权**（可伪造）。
 *        - 缺失 / 不匹配 → 401（统一响应体 {ok:false, error:{code,message}}）。
 *        - 本地 dev 兜底：NODE_ENV!=='production' 时 ADMIN 会话可触发；
 *          `CRON_SECRET` 显式置空时，dev 允许任意非空明文 secret 触发（便于本地验证）。
 *   2. 空库自动 seed：`User.count===0 && Project.count===0` → `runSeed(prisma)`
 *      （upsert 幂等；素材落盘走 storage 后端分发）。先 seed 后 runAll。
 *      ⚠️ 与设计 §7.5 / Q8 的「仅生产自动 seed」不同：按任务书 T3 拍板放宽为
 *      「空库即 seed」（本地回归用空 sqlite 验证同一逻辑，无副作用——本地
 *      `db:reset` 后库非空，不会误触发）。
 *   3. runAll()：archiveExpired → purgeArchived → gcTmp → scanOrphans。
 *   4. 模块级 in-flight 守卫（尽力而为；真正的幂等靠状态机转移）。
 *
 * 审计：不写 AuditLog（无会话主体），留痕走 Lifecycle 已有的 CleanupLog。
 * 响应：统一 `ok({...})`。
 */

import type { NextRequest } from 'next/server';

import { getSession, isAdminRole } from '@/lib/auth';
import { runAll } from '@/lib/lifecycle';
import { prisma } from '@/lib/prisma';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import { runSeed } from '../../../../../prisma/seed-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 预留自动 seed + runAll 耗时（Hobby 函数上限 300s）。 */
export const maxDuration = 120;

/** 模块级 in-flight 守卫：上一轮未结束时跳过本轮。 */
let inflight = false;

/**
 * 常量时间字符串比较，避免 secret 被计时侧信道逐字节猜出。
 * （与 admin/cleanup/run 的 safeEqual 同模式）
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 提取调用方提供的 secret（三种方式任一）。
 *
 * @returns 空串表示未提供。
 */
function extractSecret(request: NextRequest): string {
  const bearer = request.headers.get('authorization') ?? '';
  if (bearer.toLowerCase().startsWith('bearer ')) {
    return bearer.slice('bearer '.length).trim();
  }
  const header = request.headers.get('x-cron-secret') ?? '';
  if (header !== '') return header.trim();
  return (request.nextUrl.searchParams.get('secret') ?? '').trim();
}

/**
 * 鉴权。失败一律抛 AppError(NOT_LOGGED_IN) → 401。
 */
async function authorize(request: NextRequest): Promise<void> {
  const provided = extractSecret(request);
  const configuredRaw = process.env.CRON_SECRET;
  const configured = configuredRaw !== undefined && configuredRaw !== '' ? configuredRaw : '';
  const isDev = process.env.NODE_ENV !== 'production';

  if (configured !== '') {
    // 已配置 secret：生产唯一路径是 secret；dev 下 ADMIN 会话可兜底（便于联调）
    if (provided !== '' && safeEqual(provided, configured)) return;
    if (isDev) {
      const session = await getSession().catch(() => null);
      if (session && isAdminRole(session.role)) return;
    }
    console.warn('[cron][auth] secret 缺失或不匹配');
    throw new AppError(ERROR_CODE.NOT_LOGGED_IN, 'Cron 密钥无效');
  }

  // CRON_SECRET 显式置空：生产恒拒绝（fail-closed）；dev 允许任意非空明文 secret 或 ADMIN 会话
  if (!isDev) {
    console.warn('[cron][auth] NODE_ENV=production 但 CRON_SECRET 未配置，拒绝触发');
    throw new AppError(ERROR_CODE.NOT_LOGGED_IN, 'Cron 密钥未配置');
  }
  if (provided !== '') return;
  const session = await getSession().catch(() => null);
  if (session && isAdminRole(session.role)) return;
  console.warn('[cron][auth] dev 模式 secret 与会话均未通过');
  throw new AppError(ERROR_CODE.NOT_LOGGED_IN, 'Cron 密钥无效');
}

/**
 * 空库判定：用户与作品都为空才视为「全新库」，触发自动 seed。
 */
async function isEmptyDatabase(): Promise<boolean> {
  const [userCount, projectCount] = await Promise.all([prisma.user.count(), prisma.project.count()]);
  return userCount === 0 && projectCount === 0;
}

/** 执行体（GET/POST 共用）。 */
async function handle(request: NextRequest) {
  const schedule = request.headers.get('x-vercel-cron-schedule');
  if (schedule) {
    console.log(`[cron][trigger] x-vercel-cron-schedule=${schedule}`);
  }

  if (inflight) {
    return ok({ skipped: true, message: '已有清理任务在执行，跳过本次触发' });
  }

  inflight = true;
  try {
    const started = Date.now();
    let seeded = false;

    // 空库自动 seed（先 seed 后 runAll，保证清理任务在完整数据上执行）
    if (await isEmptyDatabase()) {
      await runSeed(prisma);
      seeded = true;
    }

    const result = await runAll();
    return ok({
      batchId: result.batchId,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: Date.now() - started,
      seeded,
      reports: result.reports,
      totals: result.totals,
    });
  } finally {
    inflight = false;
  }
}

export async function GET(request: NextRequest) {
  try {
    await authorize(request);
    return await handle(request);
  } catch (error) {
    return toErrorResponse(error, 'cron:run');
  }
}

export async function POST(request: NextRequest) {
  try {
    await authorize(request);
    return await handle(request);
  } catch (error) {
    return toErrorResponse(error, 'cron:run');
  }
}
