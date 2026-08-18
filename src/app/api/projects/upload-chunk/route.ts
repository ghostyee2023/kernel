/**
 * POST /api/projects/upload-chunk
 *
 * 三段式上传第 2 段：接收单个分片。
 *
 * 请求体为 `multipart/form-data`：
 *   - uploadId: string
 *   - index:    number（0 起）
 *   - chunk:    Blob
 *
 * 幂等：重复上传同一 index 视为覆盖，不会重复计数。
 */

import type { NextRequest } from 'next/server';

import { requireUser } from '@/lib/auth';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import type { UploadChunkResult } from '@/lib/types';
import * as session from '@/lib/upload/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // 鉴权最先：上传三段式均要求登录（docs/03 §3.1）
    await requireUser();

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求必须是 multipart/form-data');
    }

    const uploadId = String(form.get('uploadId') ?? '').trim();
    if (uploadId === '') {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '缺少 uploadId');
    }

    const index = Number(form.get('index'));
    if (!Number.isInteger(index) || index < 0) {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '分片序号无效');
    }

    const chunk = form.get('chunk');
    if (!(chunk instanceof Blob)) {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '缺少分片内容');
    }

    const buffer = Buffer.from(await chunk.arrayBuffer());
    const updated = await session.writeChunkAt(uploadId, index, buffer);

    const data: UploadChunkResult = {
      uploadId,
      received: updated.receivedChunks.length,
      total: updated.totalChunks,
    };
    return ok(data);
  } catch (error) {
    return toErrorResponse(error, 'upload-chunk');
  }
}
