/**
 * POST /api/projects/upload-init
 *
 * 三段式上传第 1 段：登记文件元信息，返回 uploadId 与分片计划。
 * 此时**尚未收到任何字节**，只做体积与模式的前置校验。
 */

import type { NextRequest } from 'next/server';

import { requireUser } from '@/lib/auth';
import { UPLOAD_MODE, type UploadMode } from '@/lib/constants';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import { ensureDataSkeleton } from '@/lib/storage';
import type { UploadInitResult } from '@/lib/types';
import * as session from '@/lib/upload/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 请求体。 */
interface InitBody {
  fileName?: unknown;
  fileSize?: unknown;
  mode?: unknown;
}

/** 归一化上传模式。 */
function normalizeMode(raw: unknown): UploadMode {
  if (raw === UPLOAD_MODE.ZIP || raw === UPLOAD_MODE.SINGLE_FILE) return raw;
  throw new AppError(ERROR_CODE.VALIDATION_FAILED, '上传模式只能是 ZIP 或 SINGLE_FILE');
}

export async function POST(request: NextRequest) {
  try {
    // 鉴权最先：上传三段式均要求登录（docs/03 §3.1）
    await requireUser();
    await ensureDataSkeleton();

    let body: InitBody;
    try {
      body = (await request.json()) as InitBody;
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    const fileName = typeof body.fileName === 'string' ? body.fileName : '';
    const fileSize = Number(body.fileSize);
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '文件体积无效');
    }

    const created = await session.init(fileName, Math.floor(fileSize), normalizeMode(body.mode));

    const data: UploadInitResult = {
      uploadId: created.uploadId,
      chunkSize: created.chunkSize,
      totalChunks: created.totalChunks,
      expiresAt: created.expiresAt,
    };
    return ok(data, undefined, 201);
  } catch (error) {
    return toErrorResponse(error, 'upload-init');
  }
}
