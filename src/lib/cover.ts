/**
 * 确定性封面占位图。
 *
 * P0 无截图服务（Playwright 在黑名单内），改用 slug hash 推导的品牌渐变 SVG。
 * 同一 slug 永远得到同一张图，便于缓存与视觉稳定。
 * ⬆️ P1 换成真实首屏截图后，只需让 `coverUrl` 指向截图地址，其余代码不变。
 */

/** 品牌三锚点色相（Iris / Cyan / Magenta），以 HSL 表达以避免硬编码十六进制。 */
const BRAND_HUES: readonly number[] = [233, 177, 328] as const;

/**
 * 稳定的 32 位字符串哈希（FNV-1a 变体）。
 *
 * @param input 输入字符串。
 * @returns 非负 32 位整数。
 */
export function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 从 slug 推导出的封面配色。 */
export interface CoverPalette {
  from: string;
  via: string;
  to: string;
  /** 供文字使用的高对比色 */
  ink: string;
  /** 旋转角度 */
  angle: number;
}

/**
 * 由 slug 推导确定性配色。
 *
 * @param slug 作品短码。
 */
export function coverPalette(slug: string): CoverPalette {
  const hash = hashString(slug);
  const offset = hash % 360;
  const base = BRAND_HUES[hash % BRAND_HUES.length];
  const second = BRAND_HUES[(hash >> 3) % BRAND_HUES.length];

  const h1 = (base + (offset % 24)) % 360;
  const h2 = (second + (offset % 40)) % 360;
  const h3 = (h1 + 42 + (hash % 30)) % 360;

  return {
    from: `hsl(${h1} 58% 52%)`,
    via: `hsl(${h2} 68% 46%)`,
    to: `hsl(${h3} 62% 58%)`,
    ink: 'hsl(0 0% 100%)',
    angle: 90 + (hash % 60),
  };
}

/** 转义进入 SVG 文本节点的内容。 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 生成 16:10 的确定性渐变封面 SVG。
 *
 * @param slug 作品短码（决定配色与图案）。
 * @param title 作品标题（渲染在封面上，超长自动截断）。
 * @returns 完整的 SVG 字符串。
 */
export function buildCoverSvg(slug: string, title: string): string {
  const palette = coverPalette(slug);
  const hash = hashString(slug);
  const safeTitle = escapeXml(title.length > 18 ? `${title.slice(0, 17)}…` : title);

  const dots: string[] = [];
  for (let i = 0; i < 26; i += 1) {
    const seed = hashString(`${slug}:${i}`);
    const cx = 40 + (seed % 560);
    const cy = 30 + ((seed >> 9) % 340);
    const r = 2 + ((seed >> 5) % 5);
    const opacity = (0.06 + ((seed >> 11) % 14) / 100).toFixed(2);
    dots.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(0 0% 100%)" opacity="${opacity}"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="g" gradientTransform="rotate(${palette.angle} 0.5 0.5)">
      <stop offset="0%" stop-color="${palette.from}"/>
      <stop offset="52%" stop-color="${palette.via}"/>
      <stop offset="100%" stop-color="${palette.to}"/>
    </linearGradient>
    <radialGradient id="v" cx="50%" cy="12%" r="90%">
      <stop offset="0%" stop-color="hsl(0 0% 100%)" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="hsl(0 0% 0%)" stop-opacity="0.28"/>
    </radialGradient>
  </defs>
  <rect width="640" height="400" fill="url(#g)"/>
  <rect width="640" height="400" fill="url(#v)"/>
  ${dots.join('\n  ')}
  <g transform="translate(40 300)">
    <text font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" letter-spacing="3"
          fill="${palette.ink}" opacity="0.68">${escapeXml(slug)}</text>
    <text y="42" font-family="-apple-system, Segoe UI, PingFang SC, sans-serif" font-size="34" font-weight="600"
          letter-spacing="-1" fill="${palette.ink}">${safeTitle}</text>
  </g>
  <g transform="translate(${560 - (hash % 40)} 48)" opacity="0.9">
    <circle r="16" fill="hsl(0 0% 100%)" opacity="0.16"/>
    <path d="M0-9c4.2 2.7 6.5 5.9 6.5 9.3A6.5 6.5 0 1 1-6.5.3C-6.5-3.1-4.2-6.3 0-9Zm0 6.6a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z"
          fill="${palette.ink}" opacity="0.9"/>
  </g>
</svg>`;
}

/**
 * 生成活动的确定性渐变封面 SVG（P1 活动模块）。
 *
 * 与作品封面同源（同一品牌三锚点色相 + FNV-1a 哈希），但版式面向活动：
 * 左上角「CAMPAIGN」标签 + 居中标题 + 底部活动短码。
 * 同一活动每次渲染一致，零新增依赖，走既有 `/api/covers/[file]` 路由输出。
 *
 * @param slug 活动短码（决定配色与图案）。
 * @param title 活动标题（渲染在封面上，超长自动截断）。
 * @returns 完整的 SVG 字符串。
 */
export function buildCampaignCoverSvg(slug: string, title: string): string {
  const palette = coverPalette(slug);
  const hash = hashString(slug);
  const safeTitle = escapeXml(title.length > 22 ? `${title.slice(0, 21)}…` : title);
  const safeSlug = escapeXml(slug);

  const dots: string[] = [];
  for (let i = 0; i < 18; i += 1) {
    const seed = hashString(`${slug}:camp:${i}`);
    const cx = 30 + (seed % 580);
    const cy = 24 + ((seed >> 9) % 352);
    const r = 2 + ((seed >> 5) % 5);
    const opacity = (0.06 + ((seed >> 11) % 14) / 100).toFixed(2);
    dots.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(0 0% 100%)" opacity="${opacity}"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="g" gradientTransform="rotate(${palette.angle} 0.5 0.5)">
      <stop offset="0%" stop-color="${palette.from}"/>
      <stop offset="52%" stop-color="${palette.via}"/>
      <stop offset="100%" stop-color="${palette.to}"/>
    </linearGradient>
    <radialGradient id="v" cx="50%" cy="12%" r="90%">
      <stop offset="0%" stop-color="hsl(0 0% 100%)" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="hsl(0 0% 0%)" stop-opacity="0.28"/>
    </radialGradient>
  </defs>
  <rect width="640" height="400" fill="url(#g)"/>
  <rect width="640" height="400" fill="url(#v)"/>
  ${dots.join('\n  ')}
  <g transform="translate(40 44)">
    <rect x="-10" y="-8" width="118" height="26" rx="13" fill="hsl(0 0% 100%)" opacity="0.18"/>
    <text x="0" y="6" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" letter-spacing="2.4"
          fill="${palette.ink}" opacity="0.9">CAMPAIGN</text>
  </g>
  <g transform="translate(40 168)">
    <text x="0" y="34" font-family="-apple-system, Segoe UI, PingFang SC, sans-serif" font-size="30" font-weight="600"
          letter-spacing="-0.8" fill="${palette.ink}">${safeTitle}</text>
    <text y="76" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="14" letter-spacing="2.6"
          fill="${palette.ink}" opacity="0.72">${safeSlug}</text>
  </g>
  <g transform="translate(${560 - (hash % 40)} 330)" opacity="0.9">
    <circle r="14" fill="hsl(0 0% 100%)" opacity="0.16"/>
    <path d="M12 3.2c4.2 2.7 6.5 5.9 6.5 9.3a6.5 6.5 0 1 1-13 0c0-3.4 2.3-6.6 6.5-9.3Zm0 6.6a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z"
          fill="${palette.ink}" opacity="0.9"/>
  </g>
</svg>`;
}
