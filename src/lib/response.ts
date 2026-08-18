/**
 * 统一响应体与错误码。
 *
 * 铁律（docs/P0-架构与任务分解.md §7.4）：
 *   1. Route Handler 内禁止直接 `NextResponse.json()`，一律走 `ok()` / `fail()`
 *   2. `message` 一律中文、面向用户、可直接展示在 Toast 上
 *   3. `code` 一律大写下划线，前端按 code 分支，不解析 message
 *   4. PRIVATE 与「不存在」必须返回完全一致的 404，不得用 403 区分
 */

import { NextResponse } from 'next/server';
import type { ApiFailure, ApiSuccess, ResponseMeta } from './types';

/** P0 错误码。 */
export const ERROR_CODE = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  ZIP_INVALID: 'ZIP_INVALID',
  ZIP_TOO_MANY_ENTRIES: 'ZIP_TOO_MANY_ENTRIES',
  ZIP_ENTRY_TOO_LARGE: 'ZIP_ENTRY_TOO_LARGE',
  ZIP_BOMB_SUSPECTED: 'ZIP_BOMB_SUSPECTED',
  PATH_TRAVERSAL_DETECTED: 'PATH_TRAVERSAL_DETECTED',
  ENTRY_FILE_NOT_FOUND: 'ENTRY_FILE_NOT_FOUND',
  INVALID_EXTERNAL_URL: 'INVALID_EXTERNAL_URL',
  SLUG_RESERVED: 'SLUG_RESERVED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  GONE_ARCHIVED: 'GONE_ARCHIVED',
  SLUG_CONFLICT: 'SLUG_CONFLICT',
  UPLOAD_SESSION_NOT_FOUND: 'UPLOAD_SESSION_NOT_FOUND',
  UPLOAD_SESSION_EXPIRED: 'UPLOAD_SESSION_EXPIRED',
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  STORAGE_ERROR: 'STORAGE_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // P1 活动模块（6 个）
  CAMP_NOT_FOUND: 'CAMP_NOT_FOUND',
  CAMP_NOT_OPEN: 'CAMP_NOT_OPEN',
  CAMP_ALREADY_JOINED: 'CAMP_ALREADY_JOINED',
  CAMP_PROJECT_NOT_JOINED: 'CAMP_PROJECT_NOT_JOINED',
  VOTE_QUOTA_EXCEEDED: 'VOTE_QUOTA_EXCEEDED',
  SELF_VOTE_FORBIDDEN: 'SELF_VOTE_FORBIDDEN',
  // P3.5 认证（3 个，全部 400）
  PASSWORD_WRONG: 'PASSWORD_WRONG',
  PASSWORD_WEAK: 'PASSWORD_WEAK',
  OLD_PASSWORD_WRONG: 'OLD_PASSWORD_WRONG',
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

/** 错误码 → HTTP 状态映射（§7.4）。 */
const STATUS_MAP: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNSUPPORTED_FILE_TYPE: 400,
  ZIP_INVALID: 400,
  ZIP_TOO_MANY_ENTRIES: 400,
  ZIP_ENTRY_TOO_LARGE: 400,
  ZIP_BOMB_SUSPECTED: 400,
  PATH_TRAVERSAL_DETECTED: 400,
  ENTRY_FILE_NOT_FOUND: 400,
  INVALID_EXTERNAL_URL: 400,
  SLUG_RESERVED: 400,
  FILE_TOO_LARGE: 413,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  GONE_ARCHIVED: 410,
  SLUG_CONFLICT: 409,
  UPLOAD_SESSION_NOT_FOUND: 404,
  UPLOAD_SESSION_EXPIRED: 410,
  NOT_LOGGED_IN: 401,
  STORAGE_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  INTERNAL_ERROR: 500,
  CAMP_NOT_FOUND: 404,
  CAMP_NOT_OPEN: 409,
  CAMP_ALREADY_JOINED: 409,
  CAMP_PROJECT_NOT_JOINED: 409,
  VOTE_QUOTA_EXCEEDED: 409,
  SELF_VOTE_FORBIDDEN: 403,
  PASSWORD_WRONG: 400,
  PASSWORD_WEAK: 400,
  OLD_PASSWORD_WRONG: 400,
};

/** 各错误码的默认中文文案。 */
const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_FAILED: '提交的信息有误，请检查后重试',
  UNSUPPORTED_FILE_TYPE: '不支持的文件类型，请上传 ZIP 压缩包或单个 HTML 文件',
  ZIP_INVALID: '压缩包已损坏或不是有效的 ZIP 文件',
  ZIP_TOO_MANY_ENTRIES: '压缩包内文件过多，已超出平台上限',
  ZIP_ENTRY_TOO_LARGE: '压缩包内存在超大文件，已超出单文件上限',
  ZIP_BOMB_SUSPECTED: '压缩包解压后体积异常，已拒绝',
  PATH_TRAVERSAL_DETECTED: '检测到非法路径，请求已被拒绝',
  ENTRY_FILE_NOT_FOUND: '未找到入口文件，请确认压缩包内包含 index.html',
  INVALID_EXTERNAL_URL: '外链地址无效，请填写公网可访问的 http(s) 链接',
  SLUG_RESERVED: '该短码为系统保留词，请更换',
  FILE_TOO_LARGE: '文件体积超出上限',
  FORBIDDEN: '没有访问权限',
  NOT_FOUND: '作品不存在或已下线',
  GONE_ARCHIVED: '该作品已归档，暂时无法访问',
  SLUG_CONFLICT: '短码生成冲突，请稍后重试',
  UPLOAD_SESSION_NOT_FOUND: '上传会话不存在，请重新上传',
  UPLOAD_SESSION_EXPIRED: '上传会话已过期，请重新上传',
  NOT_LOGGED_IN: '请先登录后操作',
  STORAGE_ERROR: '存储服务异常，请稍后重试',
  NOT_IMPLEMENTED: '该能力将在后续版本开放',
  INTERNAL_ERROR: '服务开小差了，请稍后重试',
  CAMP_NOT_FOUND: '活动不存在或已下线',
  CAMP_NOT_OPEN: '活动当前不在报名/投票阶段',
  CAMP_ALREADY_JOINED: '该作品已在活动中，无法重复报名',
  CAMP_PROJECT_NOT_JOINED: '该作品未报名此活动，无法投票',
  VOTE_QUOTA_EXCEEDED: '本活动每人最多投 3 票，已达上限',
  SELF_VOTE_FORBIDDEN: '本活动不支持给自己投票',
  PASSWORD_WRONG: '用户名或密码错误',
  PASSWORD_WEAK: '新密码至少 6 位',
  OLD_PASSWORD_WRONG: '当前密码不正确',
};

/**
 * 领域错误。抛出后由 Route Handler 的 `toErrorResponse()` 统一转换。
 */
export class AppError extends Error {
  /** 业务错误码。 */
  public readonly code: ErrorCode;
  /** 附加到 error 对象上的额外字段（如 `purgeAt`）。 */
  public readonly extra: Record<string, unknown>;

  /**
   * @param code 业务错误码。
   * @param message 面向用户的中文提示，省略时取默认文案。
   * @param extra 需要透出给前端的补充字段。
   */
  constructor(code: ErrorCode, message?: string, extra: Record<string, unknown> = {}) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = 'AppError';
    this.code = code;
    this.extra = extra;
  }
}

/** 查询错误码对应的 HTTP 状态码。 */
export function statusOf(code: ErrorCode): number {
  return STATUS_MAP[code] ?? 500;
}

/** 查询错误码的默认中文文案。 */
export function messageOf(code: ErrorCode): string {
  return DEFAULT_MESSAGE[code] ?? DEFAULT_MESSAGE.INTERNAL_ERROR;
}

/**
 * 构造成功响应。
 *
 * @param data 业务数据。
 * @param meta 可选的分页等元信息。
 * @param status HTTP 状态码，默认 200。
 */
export function ok<T>(data: T, meta?: ResponseMeta, status = 200): NextResponse<ApiSuccess<T>> {
  const body: ApiSuccess<T> = meta ? { ok: true, data, meta } : { ok: true, data };
  return NextResponse.json(body, { status });
}

/**
 * 构造失败响应。
 *
 * @param code 业务错误码。
 * @param message 面向用户的中文提示，省略时取默认文案。
 * @param extra 附加到 `error` 对象上的字段。
 */
export function fail(code: ErrorCode, message?: string, extra: Record<string, unknown> = {}): NextResponse<ApiFailure> {
  const body: ApiFailure = {
    ok: false,
    error: { code, message: message ?? DEFAULT_MESSAGE[code], ...extra },
  };
  return NextResponse.json(body, { status: statusOf(code) });
}

/**
 * 把任意异常转换为统一失败响应。未知异常一律降级为 `INTERNAL_ERROR`，
 * 技术细节只进服务端日志，不泄漏到响应体。
 *
 * @param error 捕获到的异常。
 * @param scope 日志作用域标记，例：`api/projects`。
 */
export function toErrorResponse(error: unknown, scope: string): NextResponse<ApiFailure> {
  if (error instanceof AppError) {
    if (statusOf(error.code) >= 500) {
      console.error(`[${scope}][error] code=${error.code} message=${error.message}`);
    } else {
      console.warn(`[${scope}][reject] code=${error.code} message=${error.message}`);
    }
    return fail(error.code, error.message, error.extra);
  }

  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[${scope}][error] code=INTERNAL_ERROR detail=${detail}`);
  return fail(ERROR_CODE.INTERNAL_ERROR);
}
