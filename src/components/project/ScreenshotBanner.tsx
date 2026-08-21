'use client';

/**
 * ScreenshotBanner —— 作品详情页顶部的截图轮播 banner。
 *
 * 交互：
 *   - 自动轮播（每 5s 切换，鼠标悬停暂停）；
 *   - 左右箭头切换、底部指示器点击跳转；
 *   - 键盘 ← / → 切换；
 *   - 切图时淡入动画；
 *   - 当前图序号「第 x / N」与标题；
 *   - 居中裁切展示（object-fit: contain，背景柔和）；
 *   - **点击主区域 → 新窗口打开作品**（与侧栏 .visit-btn 同款 href）；
 *   - 右上角「原图」角标 → 新窗口打开全尺寸截图。
 *
 * 资源：截图通过 `/api/screenshots/{file}`（已有 immutable 缓存；demo 截图回退到 public/screenshots/）。
 */

import * as React from 'react';

import { screenshotUrl } from '@/components/upload/ScreenshotUploader';

/** 自动轮播间隔（毫秒）。 */
const AUTOPLAY_MS = 5000;

export interface ScreenshotBannerProps {
  /** 截图文件名数组（按顺序）。 */
  screenshots: string[];
  /** 作品标题（alt 用）。 */
  title: string;
  /** 点击 banner 跳转的「访问作品」链接（侧栏 .visit-btn 同款）。 */
  href: string;
}

/** 渲染截图轮播。 */
export function ScreenshotBanner({ screenshots, title, href }: ScreenshotBannerProps): React.JSX.Element | null {
  const total = screenshots.length;
  const [index, setIndex] = React.useState<number>(0);
  const [paused, setPaused] = React.useState<boolean>(false);
  if (total === 0) return null;

  const go = React.useCallback(
    (next: number): void => {
      setIndex(((next % total) + total) % total);
    },
    [total],
  );

  /** 自动轮播：多张且未悬停时按间隔切换。 */
  React.useEffect(() => {
    if (total <= 1 || paused) return;
    const timer = setInterval(() => setIndex((value) => (value + 1) % total), AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [total, paused]);

  /** 键盘左右切换。 */
  React.useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'ArrowLeft') go(index - 1);
      if (event.key === 'ArrowRight') go(index + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index]);

  const current = screenshots[index]!;
  // 外链为空时回退到「查看原图」，避免 href="" 跳回当前页
  const visitHref = href || screenshotUrl(current);

  return (
    <div
      className="banner"
      aria-roledescription="carousel"
      aria-label={`${title} 截图轮播`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <a
        className="banner__stage"
        href={visitHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`在新窗口打开作品《${title}》`}
        title={visitHref}
      >
        {/* key=index 使切图时重新挂载，触发淡入动画 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={index}
          src={screenshotUrl(current)}
          alt={`${title} 截图 ${index + 1}`}
          loading={index === 0 ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
        />
        <span className="banner__hint" aria-hidden="true">
          点击访问作品 ↗
        </span>
      </a>

      {/* 查看原图：打开全尺寸截图（新窗口） */}
      <a
        className="banner__origin"
        href={screenshotUrl(current)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="查看原图"
        title="查看原图"
      >
        原图
      </a>

      {total > 1 ? (
        <>
          <button
            type="button"
            className="banner__nav banner__nav--prev"
            aria-label="上一张"
            onClick={() => go(index - 1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="banner__nav banner__nav--next"
            aria-label="下一张"
            onClick={() => go(index + 1)}
          >
            ›
          </button>
          <ol className="banner__dots" role="tablist" aria-label="选择截图">
            {screenshots.map((_, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="banner__dot"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={`第 ${i + 1} 张`}
                  onClick={() => go(i)}
                />
              </li>
            ))}
          </ol>
          <span className="banner__count" aria-live="polite">
            {index + 1} / {total}
          </span>
        </>
      ) : null}
    </div>
  );
}
