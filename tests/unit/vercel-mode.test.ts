/**
 * 双模式判定探针（Vercel 试验部署 · T5 回归清单 #8，任务书 T5 第 12 项）。
 *
 * 在**无真实 Turso / Blob** 的环境下验证分支逻辑不炸：
 *   1. `isTursoUrl` / `resolvePrismaConfig`：`libsql:` 前缀 → turso 分支；
 *      token 缺失抛错；本地 URL 回落 `file:./dev.db` 原生引擎。
 *   2. `createPrismaClient()`：libsql URL + 假 token 下「构造」不抛错
 *      （构造是惰性的，不建连；验证分支选择本身）。
 *   3. `isBlobBackend()`：NODE_ENV=production 且（BLOB_TOKEN / BLOB_READ_WRITE_TOKEN）
 *      存在 → true；其余全部 false（本地桩零破坏）。
 *
 * 运行：随 tests/unit 一起被 `node --require ./tests/qa/qa-register.cjs --import tsx --test tests/unit/*.test.ts` 执行。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient, isTursoUrl, resolvePrismaConfig } from '../../src/lib/prisma';
import { isBlobBackend } from '../../src/lib/storage';

/** 受控的环境变量集合（其余云变量一律清除，保证判定干净）。 */
const CLOUD_KEYS = [
  'DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'BLOB_TOKEN',
  'BLOB_READ_WRITE_TOKEN',
  'BLOB_STORE_ID',
  'NODE_ENV',
] as const;

/**
 * 快照 / 恢复关键环境变量。
 *
 * @param env 要设置的值；值为 undefined 表示删除该变量；未列出的键一律删除。
 */
function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const key of CLOUD_KEYS) saved.set(key, process.env[key]);

  // @types/node 把 NODE_ENV 声明为只读属性，统一走索引签名写入
  const envAny = process.env as Record<string, string | undefined>;

  try {
    for (const key of CLOUD_KEYS) {
      if (Object.prototype.hasOwnProperty.call(env, key)) {
        const value = env[key];
        if (value === undefined) delete envAny[key];
        else envAny[key] = value;
      } else {
        delete envAny[key];
      }
    }
    fn();
  } finally {
    for (const key of CLOUD_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete envAny[key];
      else envAny[key] = value;
    }
  }
}

describe('vercel-mode · 数据层双模式判定（prisma 工厂）', () => {
  it('isTursoUrl：libsql: 前缀为云模式，file:/sqlite:/缺失/其它为本地', () => {
    assert.equal(isTursoUrl('libsql://demo-org.turso.io'), true);
    assert.equal(isTursoUrl('file:./dev.db'), false);
    assert.equal(isTursoUrl('sqlite:./dev.db'), false);
    assert.equal(isTursoUrl(undefined), false);
    assert.equal(isTursoUrl('postgresql://user:pass@host:5432/kernel'), false);
  });

  it('resolvePrismaConfig：本地缺省回落 file:./dev.db 且 turso=false（与改造前一致）', () => {
    withEnv({}, () => {
      const config = resolvePrismaConfig();
      assert.equal(config.turso, false);
      assert.equal(config.url, 'file:./dev.db');
      assert.equal(config.authToken, undefined);
    });
  });

  it('resolvePrismaConfig：libsql: 但缺 TURSO_AUTH_TOKEN → 抛错（分支判定先行，fail-closed）', () => {
    withEnv({ DATABASE_URL: 'libsql://demo-org.turso.io' }, () => {
      assert.throws(() => resolvePrismaConfig(), /TURSO_AUTH_TOKEN/);
    });
  });

  it('resolvePrismaConfig：libsql: + token → turso=true 且透传 authToken', () => {
    withEnv({ DATABASE_URL: 'libsql://demo-org.turso.io', TURSO_AUTH_TOKEN: 'fake-token' }, () => {
      const config = resolvePrismaConfig();
      assert.equal(config.turso, true);
      assert.equal(config.url, 'libsql://demo-org.turso.io');
      assert.equal(config.authToken, 'fake-token');
    });
  });

  it('createPrismaClient：libsql URL + token 下「构造」不抛错（无真实 Turso 不建连）', () => {
    withEnv({ DATABASE_URL: 'libsql://demo-org.turso.io', TURSO_AUTH_TOKEN: 'fake-token' }, () => {
      let client: PrismaClient | null = null;
      try {
        client = createPrismaClient();
      } catch (error) {
        assert.fail(`构造 PrismaClient（adapter 分支）不应抛错：${(error as Error).message}`);
      } finally {
        void client?.$disconnect().catch(() => undefined);
      }
    });
  });

  it('createPrismaClient：本地 file: URL 构造不抛错（原生引擎分支）', () => {
    withEnv({ DATABASE_URL: 'file:./dev.db' }, () => {
      let client: PrismaClient | null = null;
      try {
        client = createPrismaClient();
      } catch (error) {
        assert.fail(`构造 PrismaClient（本地分支）不应抛错：${(error as Error).message}`);
      } finally {
        void client?.$disconnect().catch(() => undefined);
      }
    });
  });
});

describe('vercel-mode · 存储层双模式判定（blob 后端）', () => {
  it('本地桩（非生产 / 无 token）→ isBlobBackend()=false', () => {
    withEnv({ NODE_ENV: 'development' }, () => {
      assert.equal(isBlobBackend(), false);
    });
  });

  it('NODE_ENV=production 但无 token → 回退本地磁盘（false，部署不崩）', () => {
    withEnv({ NODE_ENV: 'production' }, () => {
      assert.equal(isBlobBackend(), false);
    });
  });

  it('NODE_ENV=production + BLOB_TOKEN → true', () => {
    withEnv({ NODE_ENV: 'production', BLOB_TOKEN: 'vercel_blob_rw_fake' }, () => {
      assert.equal(isBlobBackend(), true);
    });
  });

  it('NODE_ENV=production + BLOB_READ_WRITE_TOKEN → true（平台自动注入兼容）', () => {
    withEnv({ NODE_ENV: 'production', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_fake' }, () => {
      assert.equal(isBlobBackend(), true);
    });
  });
});
