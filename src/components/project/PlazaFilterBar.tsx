'use client';

/**
 * 广场筛选条：排序切换 + 关键词搜索 + 活动筛选（P1 活动模块）。
 *
 * 状态放在 URL（`?q=&sort=&campaign=`）而不是组件里 —— 刷新、分享、后退都能还原现场，
 * 服务端也能直接按 searchParams 渲染，不需要额外的客户端数据请求。
 *
 * P1：`票数` 排序已激活（`?sort=votes`，按 ProjectStats.voteCount 倒序）；
 * `最热` 需要真实热度分（hotScore 重算），仍明确置灰而不是假装能用。
 *
 * 活动筛选：选项来自 `campaignService.listSelectable()`（effective voting/ended，
 * §八 Q7），选择写回 `?campaign=slug`，与 q/sort/page 共存。
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/** 可筛活动选项。 */
export interface CampaignFilterOption {
  slug: string;
  title: string;
}

/** 组件属性。 */
export interface PlazaFilterBarProps {
  /** 当前关键词（来自 URL）。 */
  q?: string;
  /** 当前排序（来自 URL）。 */
  sort?: 'new' | 'votes';
  /** 命中总数，用于右侧计数。 */
  total: number;
  /** 可筛活动（effective voting/ended）。 */
  campaigns?: CampaignFilterOption[];
  /** 当前选中的活动 slug（来自 URL）。 */
  campaign?: string;
}

/** 渲染筛选条。 */
export function PlazaFilterBar({
  q = '',
  sort = 'new',
  total,
  campaigns = [],
  campaign = '',
}: PlazaFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [keyword, setKeyword] = useState<string>(q);

  // URL 变化（例如点了「清空」或浏览器后退）时同步回输入框
  useEffect(() => {
    setKeyword(q);
  }, [q]);

  /**
   * 切换排序：写回 URL（保留 q + campaign），翻页重置到第一页。
   * `new` 是默认值，从 URL 中移除以保持链接干净。
   */
  const changeSort = (next: 'new' | 'votes'): void => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'new') params.delete('sort');
    else params.set('sort', next);
    params.delete('page');

    const query = params.toString();
    router.push(query === '' ? '/' : `/?${query}`);
  };

  /** 提交搜索：写回 URL，翻页重置到第一页。 */
  const submit = (next: string): void => {
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = next.trim();

    if (trimmed === '') params.delete('q');
    else params.set('q', trimmed);
    params.delete('page');

    const query = params.toString();
    router.push(query === '' ? '/' : `/?${query}`);
  };

  /** 切换活动筛选：写回 URL，翻页重置到第一页。 */
  const changeCampaign = (next: string): void => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === '') params.delete('campaign');
    else params.set('campaign', next);
    params.delete('page');

    const query = params.toString();
    router.push(query === '' ? '/' : `/?${query}`);
  };

  return (
    <div className="filterbar">
      <div className="filterbar__inner">
        <div className="segment" role="group" aria-label="排序方式">
          <button type="button" aria-pressed={sort === 'new'} onClick={() => changeSort('new')}>
            最新
          </button>
          <button type="button" aria-pressed="false" disabled title="P0 暂未开放，需要真实热度数据">
            最热
          </button>
          <button type="button" aria-pressed={sort === 'votes'} onClick={() => changeSort('votes')}>
            票数
          </button>
        </div>

        {campaigns.length > 0 ? (
          <>
            <span className="divider-v" aria-hidden="true" />
            <select
              className="select filterbar__campaign"
              aria-label="按活动筛选"
              value={campaign}
              onChange={(event) => changeCampaign(event.target.value)}
            >
              <option value="">全部活动</option>
              {campaigns.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.title}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <span className="t-body-sm muted">
          共 <strong className="mono">{total}</strong> 件作品
        </span>

        <span className="nav__spacer" />

        <form
          className="search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            submit(keyword);
          }}
        >
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
            <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="m13.5 13.5 3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={keyword}
            placeholder="搜索作品标题或简介"
            aria-label="搜索作品"
            onChange={(event) => setKeyword(event.target.value)}
          />
          {q !== '' ? (
            <button type="button" className="icon-btn" aria-label="清空搜索" onClick={() => submit('')}>
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </form>
      </div>
    </div>
  );
}
