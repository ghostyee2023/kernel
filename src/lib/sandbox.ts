/**
 * 沙箱静态直出的安全策略与 MIME 映射。
 *
 * 设计真源：docs/P0-架构与任务分解.md §1.4
 *
 * ⬆️ 生产化替换点：这些响应头搬到 Nginx（docs/02 §3.2），静态文件由 Nginx
 *    `root /data/projects/$slug` 直出，不再经过 Node。
 */

import {
  KERNEL_META_DIR,
  SANDBOX_BASE_PATH,
  SANDBOX_CSP_STRICT,
  SANDBOX_DOMAIN,
  SANDBOX_MODE,
  SITE_URL,
} from './constants';

/**
 * iframe 的 sandbox 属性值。**绝不包含 `allow-same-origin`**。
 * 与响应头 CSP 的 sandbox 指令逐字一致。
 */
export const IFRAME_SANDBOX_ATTR = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms';

/** CSP `sandbox` 指令（与 iframe 属性一致）。 */
const CSP_SANDBOX_DIRECTIVE = `sandbox ${IFRAME_SANDBOX_ATTR}`;

/** 扩展名 → MIME 映射。未命中一律 `application/octet-stream`（配合 nosniff）。 */
const MIME_MAP: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  map: 'application/json; charset=utf-8',
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  wasm: 'application/wasm',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
};

/** 需要长缓存的静态资源扩展名（内容通常带 hash 或永不变更）。 */
const LONG_CACHE_EXT: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'ico',
  'bmp',
  'svg',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'mp4',
  'webm',
  'mp3',
  'wav',
  'ogg',
  'wasm',
  'glb',
  'gltf',
]);

/** 取小写扩展名（不含点）。 */
export function extOf(filePath: string): string {
  const base = filePath.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/** 扩展名 → Content-Type。 */
export function contentTypeOf(filePath: string): string {
  return MIME_MAP[extOf(filePath)] ?? 'application/octet-stream';
}

/**
 * 扩展名 → Cache-Control。
 * HTML 不缓存（保证下线/归档后立刻失效），静态资源短缓存 + 可重验证。
 */
export function cacheControlOf(filePath: string): string {
  const ext = extOf(filePath);
  if (ext === 'html' || ext === 'htm' || ext === '') return 'no-store, must-revalidate';
  if (LONG_CACHE_EXT.has(ext)) return 'public, max-age=3600, must-revalidate';
  return 'public, max-age=300, must-revalidate';
}

/**
 * 组装沙箱安全响应头。
 *
 * **绝不下发 `Set-Cookie`**；CSP 不含 `allow-same-origin`，使文档处于不透明源。
 *
 * @param contentType 响应的 MIME 类型。
 * @param cacheControl 缓存策略。
 */
export function buildSecurityHeaders(contentType: string, cacheControl: string): Headers {
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', cacheControl);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('X-Robots-Tag', 'noindex, nofollow');

  const csp = [SANDBOX_CSP_STRICT ? CSP_SANDBOX_DIRECTIVE : null, "form-action 'none'"]
    .filter((part): part is string => part !== null)
    .join('; ');
  headers.set('Content-Security-Policy', csp);

  return headers;
}

/**
 * 归一化沙箱请求路径。
 *
 * 规则：
 *   - 空路径 → 空串（由调用方替换为 entryFile）
 *   - 拒绝任何以 `.` 开头的路径段（含 `.kernel/`、`..`）
 *   - 拒绝含 `\0` 或反斜杠的段
 *
 * @param parts App Router 的 catch-all 片段数组。
 * @returns 归一化后的 POSIX 相对路径；非法时返回 `null`（调用方回 403）。
 */
export function normalizeRequestPath(parts: string[] | undefined): string | null {
  if (!parts || parts.length === 0) return '';

  const segments: string[] = [];
  for (const raw of parts) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === '' || segment === '.') continue;
    if (segment.startsWith('.')) return null; // 覆盖 ..、.kernel、.git 等
    if (segment.includes('\0') || segment.includes('/') || segment.includes('\\')) return null;
    segments.push(segment);
  }

  const joined = segments.join('/');
  if (joined.toLowerCase().startsWith(`${KERNEL_META_DIR}/`)) return null;
  return joined;
}

/**
 * 构造作品的沙箱访问地址。
 *
 * ⬆️ 生产切 `subdomain` 模式后返回 `https://{slug}.{SANDBOX_DOMAIN}`，调用方无需改动。
 */
export function buildSandboxUrl(slug: string): string {
  if (SANDBOX_MODE === 'subdomain') return `https://${slug}.${SANDBOX_DOMAIN}`;
  return `${SITE_URL}${SANDBOX_BASE_PATH}/${slug}/`;
}

/** 构造作品的站内详情页地址。 */
export function buildDetailUrl(slug: string): string {
  return `${SITE_URL}/w/${slug}`;
}

/** 构造作品的状态页地址（归档 / 已清除的友好落地页）。 */
export function buildStatusUrl(slug: string): string {
  return `${SITE_URL}/_status/${slug}`;
}

/** 面向 UI 展示的短链文本（去掉协议前缀，便于大字号展示）。 */
export function displayShortLink(slug: string): string {
  return buildSandboxUrl(slug).replace(/^https?:\/\//, '').replace(/\/$/, '');
}
