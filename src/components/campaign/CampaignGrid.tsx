/**
 * 活动卡片网格（P1 活动模块）。
 *
 * 响应式复用 `.camp-grid` 样式（1280: 4 列 / 1024: 3 列 / 768: 2 列 / 480: 1 列），
 * 空态复用既有 `.empty` 设计系统类。
 */

import { CampaignCard } from './CampaignCard';
import type { CampaignCardDTO } from '@/lib/types';

/** 组件属性。 */
export interface CampaignGridProps {
  campaigns: CampaignCardDTO[];
  emptyTitle?: string;
  emptyDescription?: string;
}

/** 渲染活动卡片网格。 */
export function CampaignGrid({
  campaigns,
  emptyTitle = '还没有活动',
  emptyDescription = '管理员创建活动后，会展示在这里。',
}: CampaignGridProps): React.JSX.Element {
  if (campaigns.length === 0) {
    return (
      <div className="empty">
        <div className="empty__icon" aria-hidden="true">
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 17h6M4 21h10" />
            <path d="M17 8a3 3 0 1 0-3 3l4 4 4-4a3 3 0 0 0-3-3Z" />
            <path d="M6 3h12" />
            <path d="M6 7h12" />
          </svg>
        </div>
        <h2 className="t-headline">{emptyTitle}</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          {emptyDescription}
        </p>
      </div>
    );
  }

  return (
    <div className="camp-grid">
      {campaigns.map((campaign) => (
        <CampaignCard key={campaign.id} campaign={campaign} />
      ))}
    </div>
  );
}
