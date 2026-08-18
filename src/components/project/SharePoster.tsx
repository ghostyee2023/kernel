'use client';

/**
 * 分享海报：确定性渐变封面 + 作品标题 + 短链 + 二维码，canvas 一键下载 PNG。
 *
 * P0 占位实现（架构文档已标注 ⬆️）：真实作品截图封面是 P1 用 Playwright/Satori
 * 做的事，这里先用品牌渐变保证「海报可下载、可扫码」链路闭环。
 *
 * 色值约束：从 CSS 变量实时读取（--color-primary / --color-accent-magenta），
 * 不出现硬编码 hex —— 遵守「色值真源只在 globals.css DESIGN TOKENS」约定，
 * 也天然适配明暗两套主题。
 */

import { useState } from 'react';
import QRCode from 'qrcode';

import { Button } from '@/components/ui';

/** 组件属性。 */
export interface SharePosterProps {
  /** 作品标题（海报主文案）。 */
  title: string;
  /** 作品短码（下载文件名）。 */
  slug: string;
  /** 完整可访问链接（二维码内容）。 */
  url: string;
  /** 按钮样式：详情页 secondary、发布成功页 primary（对齐原型两处 poster-btn）。 */
  variant?: 'secondary' | 'primary';
  className?: string;
}

/** 海报画布尺寸（600×800 竖版，接近分享卡片比例）。 */
const POSTER_W = 600;
const POSTER_H = 800;

/** 读 CSS 变量；SSR 或未定义时回退到与 globals.css DESIGN TOKENS 相同的值。 */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

/** 按宽度折行（最大两行，超出截断加省略号）。 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 2): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  let line = '';

  for (const ch of chars) {
    const probe = line + ch;
    if (ctx.measureText(probe).width > maxWidth && line !== '') {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) {
        // 折满后截断当前行
        const clipped = lines[maxLines - 1];
        while (clipped.length > 0 && ctx.measureText(`${clipped}…`).width > maxWidth) {
          // 从尾部逐字收窄（对 CJK 与拉丁混排都有效）
          lines[maxLines - 1] = clipped.slice(0, -1);
        }
        lines[maxLines - 1] = `${lines[maxLines - 1]}…`;
        return lines;
      }
    } else {
      line = probe;
    }
  }
  if (line !== '') lines.push(line);
  return lines.slice(0, maxLines);
}

/** 渲染「下载分享海报」按钮；点击时生成海报并触发下载。 */
export function SharePoster({ title, slug, url, variant = 'secondary', className }: SharePosterProps) {
  const [busy, setBusy] = useState<boolean>(false);

  const handleDownload = async (): Promise<void> => {
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = POSTER_W;
      canvas.height = POSTER_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // —— 背景：品牌对角渐变（读 CSS 变量，跟随主题） ——
      const primary = cssVar('--color-primary', '#4C5BD4');
      const magenta = cssVar('--color-accent-magenta', '#E0489A');
      const gradient = ctx.createLinearGradient(0, 0, POSTER_W, POSTER_H);
      gradient.addColorStop(0, primary);
      gradient.addColorStop(1, magenta);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, POSTER_W, POSTER_H);

      const white = '#FFFFFF';
      ctx.textBaseline = 'middle';

      // —— 顶部：品牌 ——
      ctx.fillStyle = `${white}B8`; // 白 72%
      ctx.font = '600 24px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText('Kernel · 创意种子', 48, 64);

      // —— 中部：标题（最多两行，居中） ——
      ctx.fillStyle = white;
      ctx.font = '600 44px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      const titleLines = wrapText(ctx, title, POSTER_W - 96, 2);
      const titleStart = 300 - (titleLines.length - 1) * 30;
      titleLines.forEach((line, index) => {
        const width = ctx.measureText(line).width;
        ctx.fillText(line, (POSTER_W - width) / 2, titleStart + index * 60);
      });

      // —— 短链 ——
      const shortLink = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      ctx.fillStyle = `${white}B8`;
      ctx.font = '500 24px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      const linkWidth = ctx.measureText(shortLink).width;
      ctx.fillText(shortLink, (POSTER_W - linkWidth) / 2, 430);

      // —— 底部：二维码（白底圆角卡） ——
      const qrSize = 220;
      const qrX = (POSTER_W - qrSize) / 2;
      const qrY = 480;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(qrX - 14, qrY - 14, qrSize + 28, qrSize + 28, 18);
      ctx.fill();

      const qrDataUrl = await QRCode.toDataURL(url, {
        width: qrSize,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      const qrImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('二维码加载失败'));
        img.src = qrDataUrl;
      });
      ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

      // —— 底部：slogan ——
      ctx.fillStyle = `${white}B8`;
      ctx.font = '500 22px system-ui, -apple-system, sans-serif';
      const slogan = 'Core. Code. Create.';
      const sloganWidth = ctx.measureText(slogan).width;
      ctx.fillText(slogan, (POSTER_W - sloganWidth) / 2, 770);

      // —— 触发下载 ——
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${slug}-poster.png`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      onClick={() => void handleDownload()}
      disabled={busy}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
        <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
      </svg>
      {busy ? '生成中…' : '下载分享海报'}
    </Button>
  );
}
