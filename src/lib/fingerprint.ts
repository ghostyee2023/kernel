'use client';

/**
 * 设备指纹采集（P2 风控模块）—— 原生零依赖。
 *
 * 设计真源：docs/P2-风控模块设计.md §1.3。
 *
 * 约束（code review checklist）：
 *   1. 本文件只能被 `'use client'` 组件引用（依赖 navigator/document/canvas），
 *      禁止在 Server Component 导入。
 *   2. canvas 绘制失败（隐私模式 / 禁 canvas）→ `canvasHash=''`，**不阻塞投票**
 *      （deviceHash 降级为 UA+salt）。
 *   3. salt cookie `kernel_device_salt` 为普通 document.cookie（365d），
 *      与登录会话 cookie 无关；沙箱 iframe 是不透明源读不到主站 cookie，
 *      指纹只在主站页面采集。
 *   4. `dwellMs` 粒度 = 页面挂载到点击投票的毫秒差（Date.now() 差值），原样存储。
 */

/** 指纹结果。 */
export interface Fingerprint {
  deviceHash: string;
  uaHash: string;
}

/** salt cookie 名。 */
const SALT_COOKIE = 'kernel_device_salt';
/** salt cookie 有效期（天）。 */
const SALT_COOKIE_DAYS = 365;

/** 模块加载时间 T0（页面挂载近似；dwellMs = Date.now() - T0）。 */
const MOUNT_TIME: number = typeof window !== 'undefined' ? Date.now() : 0;

/** 模块级记忆化：首次计算后缓存，同页多次投票复用。 */
let cached: Fingerprint | null = null;

/**
 * FNV-1a 32 位 hash → 8 位 hex。
 *
 * 确定性：同一输入恒输出同一 hash（不依赖 Math.random）。
 */
export function hashFnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** 生成随机 hex 串（crypto.getRandomValues 优先，不可用时降级 Math.random）。 */
function randomHex(len: number): string {
  try {
    const bytes = new Uint8Array(Math.ceil(len / 2));
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, len);
  } catch {
    let out = '';
    for (let i = 0; i < len; i += 1) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }
}

/** 读取普通 cookie（非 httpOnly）。 */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** 写入普通 cookie（Path=/、SameSite=Lax、带 Max-Age 与 Expires）。 */
function writeCookie(name: string, value: string, days: number): void {
  if (typeof document === 'undefined') return;
  const maxAge = days * 24 * 60 * 60;
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; Expires=${expires}; SameSite=Lax`;
}

/** 读取或生成 salt（365d）。 */
function ensureSalt(): string {
  const existing = readCookie(SALT_COOKIE);
  if (existing && existing !== '') return existing;
  const salt = randomHex(16);
  writeCookie(SALT_COOKIE, salt, SALT_COOKIE_DAYS);
  return salt;
}

/**
 * 确定性 canvas 绘制 → dataURL。
 *
 * 内容：品牌三色渐变 + 固定文本「kernel-fp」+ 固定噪声点。
 * 同一浏览器/设备每次结果一致；不同浏览器因字体/抗锯齿不同而区分。
 * 失败（禁 canvas / 隐私模式）返回 ''。
 */
export function drawCanvasHash(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // 品牌三色渐变（绘制内容，非 CSS token）
    const gradient = ctx.createLinearGradient(0, 0, 200, 40);
    gradient.addColorStop(0, '#4C5BD4');
    gradient.addColorStop(0.5, '#12B8B0');
    gradient.addColorStop(1, '#E0489A');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 200, 40);

    // 固定文本（字体渲染差异是跨浏览器区分度的主要来源）
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('kernel-fp', 16, 27);

    // 固定噪声点（确定性坐标，避免引入随机性导致同机 hash 漂移）
    for (let i = 0; i < 20; i += 1) {
      const x = (i * 37 + 11) % 190;
      const y = (i * 13 + 5) % 34;
      ctx.fillStyle = i % 2 === 0 ? '#FFFFFF' : '#0E1014';
      ctx.fillRect(x, y, 1, 1);
    }

    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

/**
 * 采集设备指纹（记忆化）。
 *
 * @returns { deviceHash, uaHash }；canvas 被禁时 deviceHash 降级为 UA+salt。
 * 本函数不抛异常（内部全部 try/catch），保证指纹失败不阻塞投票。
 */
export async function getDeviceFingerprint(): Promise<Fingerprint> {
  if (cached) return cached;

  const ua = typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : 'unknown';
  const uaHash = hashFnv1a(ua);
  const canvasData = drawCanvasHash();
  const canvasHash = canvasData === '' ? '' : hashFnv1a(canvasData);
  const salt = ensureSalt();
  const deviceHash = hashFnv1a(`${uaHash}|${canvasHash}|${salt}`);

  cached = { deviceHash, uaHash };
  return cached;
}

/**
 * 页面停留毫秒（挂载到调用时刻的 Date.now() 差值）。
 *
 * 首次调用前取 `MOUNT_TIME`（模块加载 ≈ 页面挂载）；调用返回 `Date.now() - T0`，
 * 原样存储，供「秒级连投」规则参考。
 */
export function getDwellMs(): number {
  return Math.max(0, Date.now() - MOUNT_TIME);
}
