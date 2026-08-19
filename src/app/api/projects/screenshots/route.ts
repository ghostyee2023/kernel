/**
 * POST /api/projects/screenshots —— 上传单张作品截图（裁剪后的成品图）。
 *
 * 契约：
 *   ① requireUser()：未登录 401
 *   ② multipart/form-data 单文件字段 `file`，缺失 400
 *   ③ 体积 > MAX_SCREENSHOT_BYTES（5MB）→ 400
 *   ④ magic number 真实类型识别（不信任扩展名/Content-Type），
 *      仅接受 jpeg / png / webp / gif → 否则 400
 *   ⑤ 文件名随机生成（{16 hex}.{ext}），不可预测、无用户输入拼接
 *   存储：本地 fs（.kernel-data/screenshots/）或 Vercel Blob（screenshots/ 前缀）双后端。
 *   返回：{ ok, data: { file, url } }，file 用于提交作品时写入 screenshots 数组。
 */

import { randomBytes } from 'node:crypto';

import type { NextRequest } from 'next/server';
import { fileTypeFromBuffer } from 'file-type';

import { requireUser } from '@/lib/auth';
import { MAX_SCREENSHOT_BYTES, SCREENSHOT_EXT_BY_TYPE } from '@/lib/constants';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import { ensureDir, isBlobBackend, screenshotBlobPath, screenshotFilePath, screenshotsRoot, writeBinaryFile } from '@/lib/storage';
import { putBlob } from '@/lib/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    await requireUser();

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 multipart 数据');
    }

    const fileEntry = form.get('file');
    if (!(fileEntry instanceof File)) {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '缺少图片字段 file');
    }
    if (fileEntry.size === 0) {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '图片内容为空');
    }
    if (fileEntry.size > MAX_SCREENSHOT_BYTES) {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '单张截图不能超过 5MB');
    }

    const buffer = Buffer.from(await fileEntry.arrayBuffer());
    const hit = await fileTypeFromBuffer(buffer);
    const ext = hit ? SCREENSHOT_EXT_BY_TYPE[hit.mime] : undefined;
    if (!ext) {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '仅支持 JPG / PNG / WebP / GIF 图片');
    }

    const file = `${randomBytes(8).toString('hex')}.${ext}`;
    if (isBlobBackend()) {
      await putBlob(screenshotBlobPath(file), buffer, { contentType: hit!.mime, cacheControlMaxAge: 31536000 });
    } else {
      await ensureDir(screenshotsRoot());
      await writeBinaryFile(screenshotFilePath(file), buffer);
    }

    console.log(`[screenshot][upload] file=${file} size=${buffer.length} type=${hit!.mime}`);
    return ok({ file, url: `/api/screenshots/${file}` });
  } catch (error) {
    return toErrorResponse(error, 'screenshots:upload');
  }
}
