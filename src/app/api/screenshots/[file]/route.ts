/**
 * GET /api/screenshots/[file] —— 下发作品截图。
 *
 * 安全：file 必须匹配 `{16 hex}.{jpg|png|webp|gif}`（文件名由服务端随机生成，
 * 不可预测、不接收用户输入拼接），否则 404。
 *
 * 存储双后端：本地 fs（.kernel-data/screenshots/）读磁盘；
 * 云模式（Vercel Blob）经 `getBlob` 读取（截图上传时已写 Blob）。
 *
 * 兜底：后端 miss 时读 `public/screenshots/{file}`，让 demo 截图在「无 Blob token」
 * 的部署（Vercel production 但未配 Blob）以及「本地 `.kernel-data` 为空」场景下
 * 仍能由仓库内置静态资源出图（demo 作品唯一来源）。
 *
 * 缓存：截图文件名不可变 → `public, max-age=31536000, immutable`。
 */

import * as path from 'node:path';

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

/** 兜底：仓库内置 demo 截图（`public/screenshots/`，与路由 FILE_RE 同白名单）。 */
function publicScreenshotPath(file: string): string {
  return path.join(process.cwd(), 'public', 'screenshots', file);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> },
): Promise<Response> {
  try {
    const { file } = await context.params;
    if (!FILE_RE.test(file)) {
      return new Response('Not Found', { status: 404 });
    }

    const ext = file.slice(file.lastIndexOf('.') + 1);
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
    const buildResponse = (buffer: Buffer): Response =>
      new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });

    // 1) 后端（Blob / 本地 .kernel-data/screenshots/）
    if (isBlobBackend()) {
      try {
        const buffer = await getBlob(screenshotBlobPath(file));
        return buildResponse(buffer);
      } catch {
        // 落到下方 public 兜底
      }
    } else {
      const absPath = screenshotFilePath(file);
      if (await pathExists(absPath)) {
        return buildResponse(await readFileBuffer(absPath));
      }
    }

    // 2) public 兜底（demo 截图，全环境可见）
    const publicAbs = publicScreenshotPath(file);
    if (await pathExists(publicAbs)) {
      return buildResponse(await readFileBuffer(publicAbs));
    }

    return new Response('Not Found', { status: 404 });
  } catch (error) {
    return toErrorResponse(error, 'screenshots:get');
  }
}
