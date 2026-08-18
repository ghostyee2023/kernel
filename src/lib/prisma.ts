/**
 * PrismaClient 工厂 + 全局单例。
 *
 * 双模式判定（docs/P0-Vercel试验部署设计.md §1.1 / §7.1，唯一权威）：
 *   - `DATABASE_URL` 以 `libsql:` 开头 → Turso 云模式：
 *       必须同时存在 `TURSO_AUTH_TOKEN`（缺失即抛错），
 *       经 `@prisma/adapter-libsql` 的 `PrismaLibSQL` adapter 走 HTTP 连 Turso；
 *   - 否则（`file:` / `sqlite:` / 缺失）→ 本地原生引擎，行为与改造前逐字一致。
 *
 * 单例模式保留：开发环境下 Next.js 模块热重载会反复求值本模块，若每次都
 * `new PrismaClient()` 会耗尽 SQLite 连接；因此把实例挂在 `globalThis` 上复用。
 * 全站 `import { prisma }` 零改动。
 */

import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';

const globalForPrisma = globalThis as unknown as { kernelPrisma?: PrismaClient };

/** Prisma 日志级别：dev 打 warn/error，生产只打 error。 */
function prismaLog(): Array<'warn' | 'error'> {
  return process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'];
}

/** 判定是否为 Turso（libsql）URL。纯函数，便于单测。 */
export function isTursoUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith('libsql:');
}

/** 解析出的 Prisma 连接配置（纯数据，便于单测双模式分支）。 */
export interface PrismaConfig {
  /** 归一化后的 DATABASE_URL（缺省 `file:./dev.db`）。 */
  url: string;
  /** Turso 认证 token；仅 turso=true 时存在。 */
  authToken?: string;
  /** 是否走 Turso（libsql adapter）分支。 */
  turso: boolean;
}

/**
 * 解析 Prisma 连接配置。
 *
 * @throws AppError INTERNAL_ERROR 当 `libsql:` URL 但缺少 `TURSO_AUTH_TOKEN`。
 */
export function resolvePrismaConfig(): PrismaConfig {
  const url = process.env.DATABASE_URL ?? 'file:./dev.db';
  if (isTursoUrl(url)) {
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!authToken) {
      console.error(
        '[prisma][config] DATABASE_URL 以 libsql: 开头但缺少 TURSO_AUTH_TOKEN（turso db tokens create {db-name}）',
      );
      throw new Error('DATABASE_URL 为 libsql: 但缺少 TURSO_AUTH_TOKEN');
    }
    return { url, authToken, turso: true };
  }
  return { url, turso: false };
}

/**
 * 创建 PrismaClient（按双模式判定选 adapter 或原生）。
 *
 * @returns 行为与 `PrismaClient` 完全兼容的实例。
 */
export function createPrismaClient(): PrismaClient {
  const config = resolvePrismaConfig();
  if (config.turso) {
    // Turso 云模式：driver adapter，HTTP 直连（表结构保持 sqlite 兼容）
    const adapter = new PrismaLibSQL({ url: config.url, authToken: config.authToken as string });
    return new PrismaClient({ adapter, log: prismaLog() });
  }
  // 本地原生引擎（与改造前一致）
  return new PrismaClient({ log: prismaLog() });
}

/** 全局共享的 Prisma 客户端。 */
export const prisma: PrismaClient = globalForPrisma.kernelPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.kernelPrisma = prisma;
}
