'use client';

/**
 * 发布成功面板。
 *
 * 「种子已种下」的收尾时刻：短链 + 二维码 + 到期提示 + 下一步动作。
 * 复用详情页的 `ShareCard`，保证两处的复制/扫码体验完全一致。
 */

import Link from 'next/link';

import { ShareCard, SharePoster } from '@/components/project';
import { Button } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import type { CreateProjectResult } from '@/lib/types';

/** 组件属性。 */
export interface PublishSuccessProps {
  result: CreateProjectResult;
  /** 作品标题（用于分享海报）。 */
  title: string;
  /** 再发布一件，重置整个向导。 */
  onPublishAnother: () => void;
}

/** 渲染成功面板。 */
export function PublishSuccess({ result, title, onPublishAnother }: PublishSuccessProps) {
  const displayUrl = result.sandboxUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    <div className="success-panel">
      <div className="success-ring" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="64" height="64">
          <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
          <path
            d="M20 33.5 28.5 42 45 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h2 className="success-panel__title">种子已经种下</h2>
      <p className="success-panel__desc">
        作品已发布，任何拿到这个链接的人都能立刻打开它。
        <br />
        有效期至 <strong>{formatDateTime(result.expireAt)}</strong>，到期前可随时续期。
      </p>

      <div className="success-panel__share">
        <ShareCard url={result.sandboxUrl} displayUrl={displayUrl} boxed={false} />
      </div>

      {result.dirPath ? (
        <p className="success-panel__path">
          本地文件目录：<code>{result.dirPath}</code>
        </p>
      ) : null}

      <div className="success-panel__actions">
        <Link className="btn btn-primary" href={result.detailUrl.replace(/^https?:\/\/[^/]+/, '')}>
          查看作品详情
        </Link>
        <SharePoster title={title} slug={result.slug} url={result.sandboxUrl} variant="primary" />
        <Button variant="secondary" onClick={onPublishAnother}>
          再发布一件
        </Button>
        <Link className="btn btn-ghost" href="/">
          回到广场
        </Link>
      </div>
    </div>
  );
}
