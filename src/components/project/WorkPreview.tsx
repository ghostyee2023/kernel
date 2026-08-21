'use client';

/**
 * WorkPreview —— 作品详情页「统一预览」单元（对齐 prototype/work-detail-redesign.html）。
 *
 * 顶部独立的截图轮播 banner（ScreenshotBanner）负责展示作品截图；本组件只承担
 * 「沙箱运行预览」这一件事：浏览器外壳 + 隔离 iframe。
 *
 * 安全：iframe 的 sandbox 属性与 PreviewFrame 完全一致（无 allow-same-origin），
 * 作品始终处于不透明源。
 */

import * as React from 'react';

import { IFRAME_SANDBOX_ATTR } from '@/lib/sandbox';

/** 组件属性。 */
export interface WorkPreviewProps {
  /** 沙箱运行地址（运行态 iframe 的 src）。 */
  sandboxUrl: string;
  /** 地址栏展示文本（去掉协议前缀的短链）。 */
  displayUrl: string;
  /** 作品标题（iframe 无障碍标题）。 */
  title: string;
  /** 点击浏览器栏「分享」图标时展开的分享面板 DOM id（可选）。 */
  sharePanelId?: string;
}

/** 渲染统一作品预览（沙箱运行）。外链作品的访问入口由详情页侧栏的 `.visit-btn` 统一承担。 */
export function WorkPreview({
  sandboxUrl,
  displayUrl,
  title,
  sharePanelId,
}: WorkPreviewProps): React.JSX.Element {
  // 通过换 key 强制 iframe 重建，比 contentWindow.location.reload() 可靠
  // （跨源 iframe 读不到 contentWindow）
  const [reloadKey, setReloadKey] = React.useState<number>(0);

  /** 浏览器栏「分享」图标：展开指定的分享面板。 */
  const openShare = (): void => {
    if (!sharePanelId) return;
    const el = document.getElementById(sharePanelId);
    if (el) el.setAttribute('open', '');
  };

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
          <button
            type="button"
            className="work-preview__iconbtn"
            onClick={() => setReloadKey((value) => value + 1)}
            title="刷新预览"
            aria-label="刷新预览"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" />
            </svg>
          </button>
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
        <iframe
          key={reloadKey}
          className="work-preview__iframe"
          src={sandboxUrl}
          title={`${title} — 沙箱预览`}
          sandbox={IFRAME_SANDBOX_ATTR}
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      </div>

      <p className="sandbox-note">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
          <path d="M12 9v4M12 17h.01" />
          <circle cx="12" cy="12" r="9" />
        </svg>
        预览运行在隔离沙箱中（iframe sandbox，无 allow-same-origin），与主站完全隔离
      </p>
    </div>
  );
}
