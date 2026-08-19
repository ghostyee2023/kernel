/**
 * GET /api/screenshots/[file] —— 下发作品截图。
 *
 * 安全：file 必须匹配 `{16 hex}.{jpg|png|webp|gif}`（文件名由服务端随机生成，
 * 不可预测、不接收用户输入拼接），否则 404。
 *
 * 存储双后端：本地 fs（.kernel-data/screenshots/）读磁盘；
 * 云模式（Vercel Blob）经 `getBlob` 读取（截图上传时已写 Blob）。
 *
 * 缓存：截图文件名不可变 → `public, max-age=31536000, immutable`。
 */

import { getBlob } from '@/lib/blob';
import { toErrorResponse } from '@/lib/response';
import { isBlobBackend, pathExists, readFileBuffer, screenshotBlobPath, screenshotFilePath } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 文件名白名单正则（服务端生成：8 字节 hex + 白名单扩展名）。 */
const FILE_RE = /^[0-9a-f]{16}\.(jpg|png|webp|gif)$/;

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> },
): Promise<Response> {
  try {
    const { file } = await context.params;
    if (!FILE_RE.test(file)) {
      return new Response('Not Found', { status: 404 });
    }

    let buffer: Buffer;
    if (isBlobBackend()) {
      try {
        buffer = await getBlob(screenshotBlobPath(file));
      } catch {
        return new Response('Not Found', { status: 404 });
      }
    } else {
      const absPath = screenshotFilePath(file);
      if (!(await pathExists(absPath))) {
        return new Response('Not Found', { status: 404 });
      }
      buffer = await readFileBuffer(absPath);
    }

    const ext = file.slice(file.lastIndexOf('.') + 1);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    return toErrorResponse(error, 'screenshots:get');
  }
}
