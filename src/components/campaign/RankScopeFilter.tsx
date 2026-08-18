'use client';

/**
 * 排行榜范围筛选（总榜 / 活动榜）—— 客户端组件（P1 活动模块）。
 *
 * 状态放 URL：`/rank`（总榜）或 `/rank?scope=campaign&campaign={slug}`（活动榜）。
 * 选项来自 `campaignService.listSelectable()`（effective voting/ended，§八 Q7）。
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';

/** 可筛活动选项。 */
export interface RankCampaignOption {
  slug: string;
  title: string;
}

/** 组件属性。 */
export interface RankScopeFilterProps {
  /** 当前范围。 */
  scope: 'global' | 'campaign';
  /** 当前选中的活动 slug（scope=campaign 时）。 */
  campaignSlug: string;
  /** 可筛活动。 */
  campaigns: RankCampaignOption[];
}

/** 渲染榜单范围筛选。 */
export function RankScopeFilter({ scope, campaignSlug, campaigns }: RankScopeFilterProps): React.JSX.Element {
  const router = useRouter();

  return (
    <div className="filterbar" style={{ position: 'static', borderBottom: 'none', padding: '0 0 12px' }}>
      <div className="filterbar__inner" style={{ padding: 0 }}>
        <div className="segment" role="group" aria-label="榜单范围">
          <Link className="segment-link" aria-pressed={scope === 'global'} href="/rank">
            总榜
          </Link>
          <span className="segment-link" aria-pressed={scope === 'campaign'}>
            活动榜
          </span>
        </div>
        <span className="divider-v" aria-hidden="true" />
        {campaigns.length > 0 ? (
          <select
            className="select filterbar__campaign"
            aria-label="选择活动榜"
            value={scope === 'campaign' ? campaignSlug : ''}
            onChange={(event) => {
              const next = event.target.value;
              router.push(next === '' ? '/rank' : `/rank?scope=campaign&campaign=${next}`);
              router.refresh();
            }}
          >
            <option value="">选择活动…</option>
            {campaigns.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.title}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}
