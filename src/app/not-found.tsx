/**
 * 404 页。
 *
 * 「作品不存在」与「作品私密」共用这一页 —— 不通过状态码差异泄漏存在性。
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/ui';

export const metadata: Metadata = {
  title: '页面不存在',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="container-prose">
      <EmptyState
        icon={
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2" />
            <path
              d="M12 13.5a4 4 0 0 1 7.6 1.6c0 2.4-3.6 2.9-3.6 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="16" cy="23" r="1.3" fill="currentColor" />
          </svg>
        }
        title="没有找到这个页面"
        desc="链接可能已经失效，或者这件作品被设为了私密。"
        action={
          <div className="empty__actions">
            <Link className="btn btn-primary" href="/">
              回到作品广场
            </Link>
            <Link className="btn btn-secondary" href="/new">
              发布新作品
            </Link>
          </div>
        }
      />
    </div>
  );
}
