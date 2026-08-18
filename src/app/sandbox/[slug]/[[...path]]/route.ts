/**
 * GET|HEAD /sandbox/{slug}/{...path}
 *
 * 沙箱直出：把作品目录下的静态文件按原样吐出，但**剥离一切同源能力**。
 *
 * 隔离手段（docs/P0-架构与任务分解.md §4.3，缺一不可）：
 *   1. 响应头 `Content-Security-Policy: sandbox allow-scripts ...`
 *      —— 不含 `allow-same-origin`，文档落入不透明源，
 *         读不到本站 cookie / localStorage / IndexedDB，也发不出同源请求；
 *   2. **永不下发 `Set-Cookie`**（`buildSecurityHeaders` 不设置该头，本文件也不追加）；
 *   3. 路径三重防护：`normalizeRequestPath`（拒 `.` 段）→ storage 内 relPath 归一化
 *      + 拒 `.kernel/` 前缀与穿越（双保险）→ 目录判定（命中目录一律 404，不做目录列举）；
 *   4. `X-Robots-Tag: noindex` 防止用户作品污染站点 SEO。
 *
 * 文件读取一律走 storage 层（readProjectFile / statProjectFile）：
 *   本地 = 磁盘文件；Vercel Blob = 公共读 URL（docs/P0-Vercel试验部署设计.md §1.2）。
 *
 * 状态映射：
 *   ACTIVE   → 200 直出
 *   ARCHIVED → 302 跳 `/_status/{slug}`（友好落地页 + 一键续期）
 *   其它     → 404（PRIVATE 与不存在表现一致，不泄漏存在性）
 *
 * ⬆️ 生产切独立沙箱域名后，本文件逻辑不变，只是被 `{slug}.{SANDBOX_DOMAIN}` 命中。
 */

import { NextResponse } from 'next/server';

import { SOURCE_TYPE } from '@/lib/constants';
import * as projectService from '@/lib/project-service';
import { AppError } from '@/lib/response';
import { buildSecurityHeaders, buildStatusUrl, cacheControlOf, contentTypeOf, normalizeRequestPath } from '@/lib/sandbox';
import { readProjectFile, statProjectFile } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Next 15 起动态参数为 Promise。 */
type Context = { params: Promise<{ slug: string; path?: string[] }> };

/** 统一的纯文本错误响应（沙箱内不返回 JSON 信封，避免误当作作品内容解析）。 */
function plain(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/**
 * 解析请求，定位项目文件（本地磁盘 / Blob 双后端）。
 *
 * @returns 命中的相对路径与元信息；失败时返回一个可直接下发的 Response。
 */
async function locate(
  slug: string,
  pathParts: string[] | undefined,
): Promise<{ relPath: string; size: number; contentType: string } | Response> {
  const resolved = await projectService.resolveForSandbox(slug);

  if (!resolved.ok) {
    if (resolved.reason === 'ARCHIVED') {
      return NextResponse.redirect(buildStatusUrl(slug), 302);
    }
    return plain(404, '作品不存在或已下线');
  }

  // 外链作品没有磁盘目录，沙箱不承载
  if (resolved.sourceType === SOURCE_TYPE.EXTERNAL_URL) {
    return plain(404, '该作品为外链形式，请从详情页跳转');
  }

  const normalized = normalizeRequestPath(pathParts);
  if (normalized === null) {
    console.warn(`[sandbox][reject-path] slug=${slug} parts=${JSON.stringify(pathParts)}`);
    return plain(403, '非法路径');
  }

  // 请求根路径时落到入口文件
  const relPath = normalized === '' ? resolved.entryFile : normalized;
  if (relPath === '') {
    return plain(404, '未配置入口文件');
  }

  let info: { size: number; contentType: string } | null = null;
  try {
    info = await statProjectFile(slug, relPath);
  } catch (error) {
    // storage 层二次校验（relPath 归一化 + .kernel/ 硬拒 + 穿越）失败 → 403
    if (error instanceof AppError) {
      console.warn(`[sandbox][traversal] slug=${slug} rel=${relPath}`);
      return plain(403, '非法路径');
    }
    throw error;
  }

  // 不存在、或命中目录，一律 404：不做目录列举，避免泄漏文件清单
  if (!info) {
    return plain(404, '文件不存在');
  }

  return { relPath, size: info.size, contentType: info.contentType };
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { slug, path: pathParts } = await context.params;

    // 1. 查 DB 确认作品状态
    const resolved = await projectService.resolveForSandbox(slug);
    if (!resolved.ok) {
      if (resolved.reason === 'ARCHIVED') return NextResponse.redirect(buildStatusUrl(slug), 302);
      return plain(404, '作品不存在或已下线');
    }

    // 外链作品没有磁盘目录，沙箱不承载
    if (resolved.sourceType === SOURCE_TYPE.EXTERNAL_URL) {
      return plain(404, '该作品为外链形式，请从详情页跳转');
    }

    // 2. 解析路径
    const normalized = normalizeRequestPath(pathParts);
    if (normalized === null) {
      console.warn(`[sandbox][reject-path] slug=${slug} parts=${JSON.stringify(pathParts)}`);
      return plain(403, '非法路径');
    }

    // 请求根路径时落到入口文件
    const relPath = normalized === '' ? resolved.entryFile : normalized;
    if (relPath === '') {
      return plain(404, '未配置入口文件');
    }

    // 3. 直接读文件（去掉 headBlob 一步，省一次 Blob 往返）
    let file: { buffer: Buffer; size: number; contentType: string } | null = null;
    try {
      file = await readProjectFile(slug, relPath);
    } catch (error) {
      // storage 层二次校验（relPath 归一化 + .kernel/ 硬拒 + 穿越）失败 → 403
      if (error instanceof AppError) {
        console.warn(`[sandbox][traversal] slug=${slug} rel=${relPath}`);
        return plain(403, '非法路径');
      }
      throw error;
    }

    // 不存在、或命中目录，一律 404：不做目录列举，避免泄漏文件清单
    if (!file) return plain(404, '文件不存在');

    // 4. 构建响应
    const headers = buildSecurityHeaders(file.contentType, cacheControlOf(relPath));
    headers.set('Content-Length', String(file.size));

    // 5. 浏览量异步自增（fire-and-forget，不阻塞响应）
    //    只有请求入口文件（即整页访问）才计一次浏览量，静态资源不计
    if (!pathParts || pathParts.length === 0) {
      projectService.incrementView(slug).catch((e: unknown) =>
        console.warn('[sandbox][view] failed', e),
      );
    }

    return new Response(new Uint8Array(file.buffer), { status: 200, headers });
  } catch (error) {
    console.error('[sandbox][error]', error);
    return plain(500, '沙箱服务异常');
  }
}

export async function HEAD(_request: Request, context: Context): Promise<Response> {
  try {
    const { slug, path: pathParts } = await context.params;
    const located = await locate(slug, pathParts);
    if (located instanceof Response) {
      return new Response(null, { status: located.status, headers: located.headers });
    }

    const headers = buildSecurityHeaders(located.contentType, cacheControlOf(located.relPath));
    headers.set('Content-Length', String(located.size));

    return new Response(null, { status: 200, headers });
  } catch (error) {
    console.error('[sandbox][error]', error);
    return new Response(null, { status: 500 });
  }
}
