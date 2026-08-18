/**
 * Vercel Blob 存储封装（基于 @vercel/blob SDK）。
 *
 * 设计真源：docs/P0-Vercel试验部署设计.md §3.2 / §7.3。
 * 原方案为 REST 直调（零依赖），但实测 Vercel Blob REST API v7 对 pathname 中
 * 含 `/` 层级的处理有 bug（pathname 被截断为 `ob`），而 @vercel/blob SDK 2.8.0
 * 的 `put()` 正确保留了完整 pathname。故改为 SDK 直调（Q3 拍板修订）。
 *
 * 只被 src/lib/storage.ts 消费；调用方永远通过 storage 公开函数，不感知后端。
 */

import { put, list, head, del } from '@vercel/blob';

/** 单个 Blob 元信息。 */
export interface BlobResult {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
  uploadedAt: string;
}

/** LIST 响应条目。 */
export interface BlobListEntry {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
}

/** LIST 响应。 */
export interface BlobListResult {
  blobs: BlobListEntry[];
  hasMore: boolean;
  cursor?: string;
}

/** PUT 选项。 */
export interface BlobPutOptions {
  contentType?: string;
  /** 允许覆盖已存在 pathname（seed / 重传需要）。 */
  allowOverwrite?: boolean;
  /** 追加随机后缀（默认 false，试验版保持确定性 pathname）。 */
  addRandomSuffix?: boolean;
  /** 公共读缓存秒数（默认 2592000 = 30 天）。 */
  cacheControlMaxAge?: number;
}

/** HEAD 返回的文件信息。 */
export interface BlobHeadResult {
  size: number;
  contentType: string;
}

/** LIST 选项。 */
export interface BlobListOptions {
  /** folded = 列目录（返回文件夹）；flat = 列文件（默认）。 */
  mode?: 'folded' | 'flat';
  limit?: number;
  cursor?: string;
}

/**
 * 读取 Blob 写 token（兼容平台自动注入与手动配置两种命名）。
 *
 * @throws Error 当 BLOB_READ_WRITE_TOKEN 与 BLOB_TOKEN 都不存在。
 */
export function blobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN ?? process.env.BLOB_TOKEN ?? '';
  if (token === '') {
    throw new Error('缺少 Blob token：请配置 BLOB_READ_WRITE_TOKEN 或 BLOB_TOKEN');
  }
  return token;
}

/**
 * 解析 Blob Store id。
 *
 * 优先 `BLOB_STORE_ID`；否则从 token 解析：token 形如 `vercel_blob_rw_{storeId}_{secret}`，
 * 按 `_` 切分后第 4 段（index 3）即 storeId。
 */
export function blobStoreId(): string {
  const explicit = process.env.BLOB_STORE_ID;
  if (explicit && explicit.trim() !== '') return explicit.trim();

  const token = blobToken();
  const parts = token.split('_');
  if (parts.length >= 4 && parts[0] === 'vercel' && parts[1] === 'blob') {
    return parts[3] ?? '';
  }
  throw new Error('无法从 Blob token 解析 storeId，请显式配置 BLOB_STORE_ID');
}

/** 拼公共读 URL（免鉴权）。按段编码，保留 `/` 层级。 */
export function blobPublicUrl(pathname: string): string {
  const encoded = pathname
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://${blobStoreId()}.public.blob.vercel-storage.com/${encoded}`;
}

/**
 * PUT 上传（写）。
 *
 * @param pathname 目标 pathname（如 `projects/{slug}/index.html`）。
 * @param data 文件字节。
 * @param opts 上传选项。
 * @returns 上传后的 Blob 元信息。
 */
export async function putBlob(pathname: string, data: Buffer | Uint8Array, opts: BlobPutOptions = {}): Promise<BlobResult> {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const result = await put(pathname, body, {
    access: 'public',
    contentType: opts.contentType,
    allowOverwrite: opts.allowOverwrite !== false,
    addRandomSuffix: opts.addRandomSuffix === true,
    cacheControlMaxAge: opts.cacheControlMaxAge,
  });
  return {
    url: result.url,
    pathname: result.pathname,
    contentType: result.contentType ?? 'application/octet-stream',
    size: 0,
    uploadedAt: new Date().toISOString(),
  };
}

/**
 * GET 读取（走公共读 URL，免鉴权）。
 *
 * @throws Error 当 pathname 不存在或网络失败。
 */
export async function getBlob(pathname: string): Promise<Buffer> {
  const url = blobPublicUrl(pathname);
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Blob 读取失败 ${pathname} HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * HEAD 探测（走公共读 URL，免鉴权），用于 statProjectFile。
 *
 * @returns 文件信息；不存在时返回 null。
 */
export async function headBlob(pathname: string): Promise<BlobHeadResult | null> {
  try {
    const result = await head(pathname);
    if (!result) return null;
    return { size: result.size ?? 0, contentType: result.contentType ?? 'application/octet-stream' };
  } catch {
    // head() throws on non-existent; return null
    return null;
  }
}

/**
 * DELETE 批量删除。
 *
 * @param urls 待删除 Blob 的公共 URL 列表。
 */
export async function deleteBlob(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  await del(urls);
}

/**
 * LIST 列 Blob。
 *
 * @param prefix pathname 前缀（如 `projects/{slug}/`）。
 * @param opts 选项：folded 列目录 / flat 列文件。
 */
export async function listBlob(prefix: string, opts: BlobListOptions = {}): Promise<BlobListResult> {
  const result = await list({
    prefix,
    mode: opts.mode === 'folded' ? 'folded' : 'expanded',
    limit: opts.limit ?? 1000,
    cursor: opts.cursor,
  });
  return {
    blobs: (result.blobs ?? []).map((b) => ({
      url: b.url,
      pathname: b.pathname,
      size: b.size,
      uploadedAt: b.uploadedAt instanceof Date ? b.uploadedAt.toISOString() : String(b.uploadedAt),
    })),
    hasMore: result.hasMore ?? false,
    cursor: result.cursor ?? undefined,
  };
}
