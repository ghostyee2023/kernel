/**
 * lib/response.ts 统一响应体测试。
 *
 * 铁律（docs/P0-架构与任务分解.md §7.4）：
 *   成功 `{ok:true,data,meta?}` / 失败 `{ok:false,error:{code,message,...}}`；
 *   code 大写下划线；message 中文；PRIVATE 与不存在同为 404；
 *   未知异常一律降级 INTERNAL_ERROR，不泄漏技术细节。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AppError,
  ERROR_CODE,
  fail,
  messageOf,
  ok,
  statusOf,
  toErrorResponse,
  type ErrorCode,
} from '../../src/lib/response';

/** 读取 NextResponse 的 JSON 体。 */
async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('response · 成功信封', () => {
  it('ok(data) → { ok:true, data }，默认 200，不带 meta 键', async () => {
    const res = ok({ slug: 'Aur9raFx' });
    assert.equal(res.status, 200);
    const body = await bodyOf(res);
    assert.deepEqual(body, { ok: true, data: { slug: 'Aur9raFx' } });
    assert.equal('meta' in body, false, '未传 meta 时不应出现 meta 键');
  });

  it('ok(data, meta, 201) → 带 meta 且状态可覆写', async () => {
    const res = ok([1, 2], { page: 1, pageSize: 12, total: 2 }, 201);
    assert.equal(res.status, 201);
    assert.deepEqual(await bodyOf(res), {
      ok: true,
      data: [1, 2],
      meta: { page: 1, pageSize: 12, total: 2 },
    });
  });

  it('Content-Type 为 application/json', () => {
    assert.match(ok({}).headers.get('content-type') ?? '', /application\/json/);
  });
});

describe('response · 失败信封', () => {
  it('fail(code) → { ok:false, error:{code,message} } 且状态按映射表', async () => {
    const res = fail(ERROR_CODE.NOT_FOUND);
    assert.equal(res.status, 404);
    assert.deepEqual(await bodyOf(res), {
      ok: false,
      error: { code: 'NOT_FOUND', message: '作品不存在或已下线' },
    });
  });

  it('fail 支持 extra 字段透传（如 purgeAt）', async () => {
    const purgeAt = '2026-09-01T00:00:00.000Z';
    const res = fail(ERROR_CODE.GONE_ARCHIVED, undefined, { slug: 'abc', purgeAt });
    assert.equal(res.status, 410);
    const body = (await bodyOf(res)) as { error: Record<string, unknown> };
    assert.equal(body.error.code, 'GONE_ARCHIVED');
    assert.equal(body.error.purgeAt, purgeAt);
    assert.equal(body.error.slug, 'abc');
  });

  it('全部错误码：code 为大写下划线、message 为中文、状态码合法', () => {
    for (const code of Object.values(ERROR_CODE) as ErrorCode[]) {
      assert.match(code, /^[A-Z][A-Z0-9_]*$/, `错误码 ${code} 应为大写下划线`);
      const message = messageOf(code);
      assert.ok(message.length > 0, `${code} 缺少默认文案`);
      assert.match(message, /[\u4e00-\u9fa5]/, `${code} 的默认文案应为中文：${message}`);
      const status = statusOf(code);
      assert.ok(status >= 400 && status <= 599, `${code} 的状态码 ${status} 不合法`);
    }
  });

  it('关键错误码 → HTTP 状态映射与设计文档一致', () => {
    const expected: Array<[ErrorCode, number]> = [
      [ERROR_CODE.VALIDATION_FAILED, 400],
      [ERROR_CODE.UNSUPPORTED_FILE_TYPE, 400],
      [ERROR_CODE.ZIP_BOMB_SUSPECTED, 400],
      [ERROR_CODE.ZIP_TOO_MANY_ENTRIES, 400],
      [ERROR_CODE.ZIP_ENTRY_TOO_LARGE, 400],
      [ERROR_CODE.PATH_TRAVERSAL_DETECTED, 400],
      [ERROR_CODE.FILE_TOO_LARGE, 413],
      [ERROR_CODE.FORBIDDEN, 403],
      [ERROR_CODE.NOT_FOUND, 404],
      [ERROR_CODE.GONE_ARCHIVED, 410],
      [ERROR_CODE.SLUG_CONFLICT, 409],
      [ERROR_CODE.UPLOAD_SESSION_EXPIRED, 410],
      [ERROR_CODE.STORAGE_ERROR, 500],
      [ERROR_CODE.INTERNAL_ERROR, 500],
    ];
    for (const [code, status] of expected) {
      assert.equal(statusOf(code), status, `${code} 应映射为 ${status}`);
    }
  });
});

describe('response · AppError 与异常收敛', () => {
  it('AppError 默认取该 code 的中文文案', () => {
    const error = new AppError(ERROR_CODE.ZIP_INVALID);
    assert.equal(error.name, 'AppError');
    assert.equal(error.code, 'ZIP_INVALID');
    assert.equal(error.message, messageOf(ERROR_CODE.ZIP_INVALID));
    assert.ok(error instanceof Error);
  });

  it('toErrorResponse(AppError) → 保留 code / message / extra', async () => {
    const error = new AppError(ERROR_CODE.ZIP_BOMB_SUSPECTED, '压缩包解压后超过 200MB 上限，已拒绝', { ratio: 999 });
    const res = toErrorResponse(error, 'qa');
    assert.equal(res.status, 400);
    const body = (await bodyOf(res)) as { error: Record<string, unknown> };
    assert.equal(body.error.code, 'ZIP_BOMB_SUSPECTED');
    assert.equal(body.error.message, '压缩包解压后超过 200MB 上限，已拒绝');
    assert.equal(body.error.ratio, 999);
  });

  it('toErrorResponse(未知异常) → 降级 INTERNAL_ERROR，不泄漏技术细节', async () => {
    const res = toErrorResponse(new TypeError('ECONNREFUSED 127.0.0.1:5432 at PrismaClient'), 'qa');
    assert.equal(res.status, 500);
    const body = (await bodyOf(res)) as { error: Record<string, unknown> };
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.equal(body.error.message, messageOf(ERROR_CODE.INTERNAL_ERROR));
    const raw = JSON.stringify(body);
    assert.equal(raw.includes('ECONNREFUSED'), false, '响应体不得泄漏底层错误');
    assert.equal(raw.includes('Prisma'), false, '响应体不得泄漏依赖名');
  });

  it('toErrorResponse(字符串异常) → 同样降级', async () => {
    const res = toErrorResponse('boom', 'qa');
    assert.equal(res.status, 500);
    assert.equal(((await bodyOf(res)) as { error: { code: string } }).error.code, 'INTERNAL_ERROR');
  });

  it('PRIVATE 与「不存在」必须表现为完全一致的 404', async () => {
    // 两条链路最终都走 fail(NOT_FOUND)，字节级一致才谈得上不泄漏存在性
    const a = await bodyOf(fail(ERROR_CODE.NOT_FOUND));
    const b = await bodyOf(toErrorResponse(new AppError(ERROR_CODE.NOT_FOUND), 'qa'));
    assert.deepEqual(a, b);
    assert.equal(statusOf(ERROR_CODE.NOT_FOUND), 404);
  });
});
