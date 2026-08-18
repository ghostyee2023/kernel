'use client';

/**
 * 后台分页条（P2）。page 从 1 起；上一页 / 下一页 / 页码 + 总数摘要。
 */

import * as React from 'react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /** 页码变化回调（由父组件负责重新取数）。 */
  onChange: (page: number) => void;
}

/** 生成页码序列：当前页前后各 1 页，首尾页保留，中间用省略号。 */
function pageNumbers(current: number, total: number): Array<number | '…'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const pages: Array<number | '…'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('…');
  for (let p = start; p <= end; p += 1) pages.push(p);
  if (end < total - 1) pages.push('…');
  pages.push(total);
  return pages;
}

/** 后台分页条。单页时返回 null。 */
export function Pagination({ page, pageSize, total, onChange }: PaginationProps): React.JSX.Element | null {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const pages = pageNumbers(page, totalPages);

  return (
    <div className="admin-pagination">
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        上一页
      </Button>
      {pages.map((item, index) =>
        item === '…' ? (
          <span key={`ellipsis-${index}`} className="admin-pagination__ellipsis" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className={cn('admin-pagination__page', item === page && 'active')}
            aria-current={item === page ? 'page' : undefined}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ),
      )}
      <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        下一页
      </Button>
      <span className="admin-pagination__info">
        共 {total} 条 · {totalPages} 页
      </span>
    </div>
  );
}
