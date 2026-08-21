'use client';

/**
 * ScreenshotBanner —— 作品详情页顶部的截图轮播 banner。
 *
 * 交互：
 *   - 左右箭头切换、底部指示器点击跳转；
 *   - 键盘 ← / → 切换；
 *   - 当前图序号「第 x / N」与标题；
 *   - 居中裁切展示（object-fit: contain，背景柔和）。
 *
 * 资源：截图通过 `/api/screenshots/{file}`（已有 immutable 缓存；demo 截图回退到 public/screenshots/）。
 */

import * as React from 'react';

import { screenshotUrl } from '@/components/upload/ScreenshotUploader';

export interface ScreenshotBannerProps {
  /** 截图文件名数组（按顺序）。 */
  screenshots: string[];
  /** 作品标题（alt 用）。 */
  title: string;
}

/** 渲染截图轮播。 */
export function ScreenshotBanner({ screenshots, title }: ScreenshotBannerProps): React.JSX.Element | null {
  const [index, setIndex] = React.useState<number>(0);
  const total = screenshots.length;
  if (total === 0) return null;

  const go = React.useCallback(
    (next: number): void => {
      const normalized = ((next % total) + total) % total;
      setIndex(normalized);
    },
    [total],
  );

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

  return (
    <div className="banner" aria-roledescription="carousel" aria-label={`${title} 截图轮播`}>
      <a className="banner__stage" href={screenshotUrl(current)} target="_blank" rel="noopener noreferrer" aria-label="查看原图">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={screenshotUrl(current)}
          alt={`${title} 截图 ${index + 1}`}
          loading={index === 0 ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
        />
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
