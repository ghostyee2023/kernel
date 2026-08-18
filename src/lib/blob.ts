/**
 * Vercel Blob REST 封装（零依赖，**不 import 任何 fs**）。
 *
 * 设计真源：docs/P0-Vercel试验部署设计.md §3.2 / §7.3（Q3 已拍板：REST 直调，不装 @vercel/blob）。
 *
 * 调用格式：
 *   PUT     https://api.vercel.com/v1/blob?pathname={path}
 *           Headers: Authorization: Bearer {token} · x-api-version: 7 · Content-Type: {type}
 *           可选: x-allow-overwrite · x-add-random-suffix · x-cache-control-max-age
 *   POST    https://api.vercel.com/v1/blob/delete   Body: {"urls":[...]}
 *   GET     https://api.vercel.com/v1/blob?prefix={prefix}&limit=1000[&mode=folded]
 *   HEAD    https://{storeId}.public.blob.vercel-storage.com/{path}（免鉴权）
 *   GET     https://{storeId}.public.blob.vercel-storage.com/{path}（免鉴权，读回）
 *
 * 只被 src/lib/storage.ts 消费；调用方永远通过 storage 公开函数，不感知后端。
 *
 * ⚠️ x-api-version 按实施时 Vercel @vercel/blob SDK 常量对齐（约 7）；若 Vercel 变更
 *    REST 契约导致维护成本上升，回退方案是加 @vercel/blob（见设计 Q3）。
 */

/** Blob 基础地址（管理面 REST）。 */
const BLOB_API_BASE = 'https://api.vercel.com/v1/blob';
/** REST 契约版本头（对齐 @vercel/blob SDK 常量）。 */
const BLOB_API_VERSION = '7';

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

/** 管理面请求头。 */
function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'x-api-version': BLOB_API_VERSION,
  };
}

/** 统一解析管理面错误响应，返回可读 message。 */
async function errorMessageOf(response: Response): Promise<string> {
  let detail = `HTTP ${response.status}`;
  try {
    const text = await response.text();
    if (text) detail = text.slice(0, 300);
  } catch {
    // 忽略响应体解析失败
  }
  return `Blob ${response.url.split('?')[0]} ${detail}`;
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
  const token = blobToken();
  const url = `${BLOB_API_BASE}?pathname=${encodeURIComponent(pathname)}`;

  const headers: Record<string, string> = {
    ...authHeaders(token),
    'Content-Type': opts.contentType ?? 'application/octet-stream',
  };
  if (opts.allowOverwrite !== false) headers['x-allow-overwrite'] = 'true';
  if (opts.addRandomSuffix === true) headers['x-add-random-suffix'] = 'true';
  if (opts.cacheControlMaxAge !== undefined) {
    headers['x-cache-control-max-age'] = String(opts.cacheControlMaxAge);
  }

  const response = await fetch(url, { method: 'PUT', headers, body: Buffer.from(data) });
  if (!response.ok) {
    throw new Error(await errorMessageOf(response));
  }
  const json = (await response.json()) as BlobResult;
  return json;
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
  const url = blobPublicUrl(pathname);
  const response = await fetch(url, { method: 'HEAD' });
  if (!response.ok) return null;
  const sizeRaw = response.headers.get('content-length');
  const size = sizeRaw ? Number.parseInt(sizeRaw, 10) : 0;
  return { size, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
}

/**
 * DELETE 批量删除（POST /delete）。
 *
 * @param urls 待删除 Blob 的公共 URL 列表。
 */
export async function deleteBlob(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const token = blobToken();
  const response = await fetch(`${BLOB_API_BASE}/delete`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls }),
  });
  if (!response.ok) {
    throw new Error(await errorMessageOf(response));
  }
}

/**
 * LIST 列 Blob。
 *
 * @param prefix pathname 前缀（如 `projects/{slug}/`）。
 * @param opts 选项：folded 列目录 / flat 列文件。
 */
export async function listBlob(prefix: string, opts: BlobListOptions = {}): Promise<BlobListResult> {
  const token = blobToken();
  const limit = opts.limit ?? 1000;
  const params = new URLSearchParams({ prefix, limit: String(limit) });
  if (opts.mode === 'folded') params.set('mode', 'folded');
  if (opts.cursor) params.set('cursor', opts.cursor);

  const url = `${BLOB_API_BASE}?${params.toString()}`;
  const response = await fetch(url, { method: 'GET', headers: authHeaders(token) });
  if (!response.ok) {
    throw new Error(await errorMessageOf(response));
  }
  const json = (await response.json()) as {
    blobs?: Array<{ url?: string; pathname?: string; size?: number; uploadedAt?: string }>;
    hasMore?: boolean;
    cursor?: string;
  };
  return {
    blobs: (json.blobs ?? []).map((b) => ({
      url: b.url ?? '',
      pathname: b.pathname ?? '',
      size: b.size ?? 0,
      uploadedAt: b.uploadedAt ?? '',
    })),
    hasMore: json.hasMore ?? false,
    cursor: json.cursor,
  };
}
