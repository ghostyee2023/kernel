'use client';

/**
 * WorkPreview —— 作品详情页「统一预览」单元（对齐 prototype/work-detail-redesign.html）。
 *
 * 将原本二选一的「截图轮播（ScreenshotBanner）/ 沙箱预览（PreviewFrame）」合并进同一个
 * 浏览器外壳：
 *   - 有截图：默认展示截图轮播（左右箭头 / 底部圆点 / 右上 `x/N` 计数 / 键盘 ←→）；
 *     点「运行沙箱」切到实时 `<iframe>`（沿用 `IFRAME_SANDBOX_ATTR`，**绝不含 allow-same-origin**），
 *     再点回到轮播；
 *   - 无截图且非外链：直接展示沙箱 iframe；
 *   - 外链作品：保留原有「外链作品」提示与「前往访问」按钮，不渲染浏览器壳。
 *
 * 安全：iframe 的 sandbox 属性与 PreviewFrame 完全一致（无 allow-same-origin），
 * 即便用户切到运行态，作品仍处于不透明源。
 */

import * as React from 'react';

import { screenshotUrl } from '@/components/upload/ScreenshotUploader';
import { IFRAME_SANDBOX_ATTR } from '@/lib/sandbox';
import { cn } from '@/lib/cn';

/** 组件属性。 */
export interface WorkPreviewProps {
  /** 截图文件名数组（按序）。空数组 = 无截图。 */
  screenshots: string[];
  /** 沙箱运行地址（运行态 iframe 的 src）。 */
  sandboxUrl: string;
  /** 地址栏展示文本（去掉协议前缀的短链）。 */
  displayUrl: string;
  /** 作品标题（alt / 无障碍）。 */
  title: string;
  /** 是否外链作品（外链时展示提示 + 前往访问，不渲染浏览器壳）。 */
  isExternal: boolean;
  /** 外链目标地址（isExternal 为 true 时生效）。 */
  externalUrl?: string;
  /** 点击浏览器栏「分享」图标时展开的分享面板 DOM id（可选）。 */
  sharePanelId?: string;
}

/** 渲染统一作品预览（截图轮播 + 沙箱运行切换）。 */
export function WorkPreview({
  screenshots,
  sandboxUrl,
  displayUrl,
  title,
  isExternal,
  externalUrl,
  sharePanelId,
}: WorkPreviewProps): React.JSX.Element {
  const hasShots = screenshots.length > 0;
  const [mode, setMode] = React.useState<'carousel' | 'sandbox'>(hasShots ? 'carousel' : 'sandbox');
  const [index, setIndex] = React.useState<number>(0);
  // 切换运行态时换 key 强制重建 iframe，比 contentWindow.location.reload() 可靠
  const [reloadKey, setReloadKey] = React.useState<number>(0);

  const total = screenshots.length;

  const go = React.useCallback(
    (next: number): void => {
      if (total === 0) return;
      const normalized = ((next % total) + total) % total;
      setIndex(normalized);
    },
    [total],
  );

  // 键盘 ← / → 切换（仅轮播态生效）
  React.useEffect(() => {
    if (mode !== 'carousel' || total <= 1) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'ArrowLeft') go(index - 1);
      if (event.key === 'ArrowRight') go(index + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index, mode, total]);

  /** 切换 运行 / 返回截图。 */
  const toggleRun = (): void => {
    setMode((prev) => {
      const next = prev === 'carousel' ? 'sandbox' : 'carousel';
      if (next === 'sandbox') setReloadKey((value) => value + 1);
      return next;
    });
  };

  /** 浏览器栏「分享」图标：展开指定的分享面板。 */
  const openShare = (): void => {
    if (!sharePanelId) return;
    const el = document.getElementById(sharePanelId);
    if (el) el.setAttribute('open', '');
  };

  // —— 外链作品：保留现有提示 + 前往访问 ——
  if (isExternal) {
    return (
      <div className="detail__external">
        <h2 className="t-title">这是一件外链作品</h2>
        <p className="muted">
          内容托管在站外，Kernel 不代为存储、也不做沙箱隔离，请自行确认来源可信。
        </p>
        <p className="linkbox">
          <span title={externalUrl}>{externalUrl}</span>
        </p>
        <a
          className="btn btn-primary"
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer external"
        >
          前往访问
        </a>
      </div>
    );
  }

  const running = mode === 'sandbox';

  return (
    <div className="work-preview">
      <div className="work-preview__bar">
        <span className="work-preview__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="work-preview__url" title={displayUrl}>
          {displayUrl}
        </span>
        <span className="work-preview__actions">
          {hasShots ? (
            <button
              type="button"
              className="work-preview__iconbtn"
              onClick={toggleRun}
              title={running ? '返回截图' : '运行沙箱'}
              aria-label={running ? '返回截图' : '运行沙箱'}
              aria-pressed={running}
            >
              {running ? (
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
          ) : null}
          {sharePanelId ? (
            <button
              type="button"
              className="work-preview__iconbtn"
              onClick={openShare}
              title="分享"
              aria-label="分享"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
              </svg>
            </button>
          ) : null}
        </span>
      </div>

      <div className="work-preview__viewport">
        {hasShots ? (
          <div
            className={cn('work-preview__slides', running && 'is-hidden')}
            aria-roledescription="carousel"
            aria-label={`${title} 截图轮播`}
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {screenshots.map((file) => (
              <div className="work-preview__slide" key={file}>
                <a
                  className="work-preview__shot"
                  href={screenshotUrl(file)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="查看原图"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshotUrl(file)}
                    alt={`${title} 截图`}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                </a>
              </div>
            ))}
          </div>
        ) : null}

        <iframe
          key={reloadKey}
          className={cn('work-preview__iframe', !running && 'is-hidden')}
          src={running ? sandboxUrl : 'about:blank'}
          title={`${title} — 沙箱预览`}
          sandbox={IFRAME_SANDBOX_ATTR}
          referrerPolicy="no-referrer"
          loading="lazy"
        />

        {hasShots && !running && total > 1 ? (
          <>
            <button
              type="button"
              className="wp-nav wp-nav--prev"
              aria-label="上一张"
              onClick={() => go(index - 1)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              className="wp-nav wp-nav--next"
              aria-label="下一张"
              onClick={() => go(index + 1)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
            <span className="wp-count" aria-live="polite">
              {index + 1} / {total}
            </span>
            <div className="wp-dots" role="tablist" aria-label="选择截图">
              {screenshots.map((file, i) => (
                <button
                  type="button"
                  key={file}
                  className={cn('wp-dot', i === index && 'is-active')}
                  role="tab"
                  aria-selected={i === index}
                  aria-label={`第 ${i + 1} 张`}
                  onClick={() => go(i)}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
