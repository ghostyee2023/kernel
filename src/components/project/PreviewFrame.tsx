'use client';

/**
 * 作品预览窗（详情页的「浏览器」外壳 + 沙箱 iframe）。
 *
 * 双重隔离：
 *   1. 服务端：沙箱 Route Handler 下发 `Content-Security-Policy: sandbox ...`；
 *   2. 客户端：iframe 的 `sandbox` 属性（`IFRAME_SANDBOX_ATTR`，同样不含 allow-same-origin）。
 *
 * 两层都不给 `allow-same-origin`，即便某一层被绕过，作品仍处于不透明源。
 */

import { useState } from 'react';

import { IconButton } from '@/components/ui';
import { IFRAME_SANDBOX_ATTR } from '@/lib/sandbox';

/** 组件属性。 */
export interface PreviewFrameProps {
  /** 沙箱地址。 */
  src: string;
  /** 地址栏展示文本。 */
  displayUrl: string;
  /** 作品标题，用于 iframe 无障碍标题。 */
  title: string;
}

/** 渲染带浏览器外壳的沙箱预览。 */
export function PreviewFrame({ src, displayUrl, title }: PreviewFrameProps) {
  // 通过换 key 强制 iframe 重建，比 contentWindow.location.reload() 可靠
  // （跨源 iframe 读不到 contentWindow）
  const [reloadKey, setReloadKey] = useState<number>(0);

  return (
    <div className="browser">
      <div className="browser__bar">
        <span className="browser__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>

        <span className="browser__url" title={displayUrl}>
          {displayUrl}
        </span>

        <span className="browser__actions">
          <IconButton
            label="刷新预览"
            onClick={() => setReloadKey((value) => value + 1)}
            title="刷新预览"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </IconButton>

          <a
            className="btn btn-ghost btn-sm"
            href={src}
            target="_blank"
            rel="noopener noreferrer external"
          >
            新窗口打开
          </a>
        </span>
      </div>

      <iframe
        key={reloadKey}
        className="browser__frame"
        src={src}
        title={`${title} — 沙箱预览`}
        sandbox={IFRAME_SANDBOX_ATTR}
        referrerPolicy="no-referrer"
        loading="lazy"
      />

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
