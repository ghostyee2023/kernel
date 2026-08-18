/**
 * 我参与的活动（个人空间 Tab 2）—— Server Component。
 *
 * SSR initialItems（campaignService.listJoinedByUser）→ 行列表：
 * 活动封面占位 + 标题链 + 状态 Badge + 时间 + 我的参赛作品数 +
 * 我的作品活动票 / 活动票累计（两值并列，口径见 §1.4 / §八 Q9）。
 */

import Link from 'next/link';

import { Badge, EmptyState } from '@/components/ui';
import { campaignStatusLabel, campaignStatusTone } from '@/components/campaign/CampaignCard';
import { CoverPlaceholder } from '@/components/project';
import { formatCount, formatDate } from '@/lib/format';
import type { JoinedCampaignDTO } from '@/lib/types';

/** 组件属性。 */
export interface JoinedCampaignsListProps {
  initialItems: JoinedCampaignDTO[];
}

/** 渲染我参与的活动列表或空态。 */
export function JoinedCampaignsList({ initialItems }: JoinedCampaignsListProps): React.JSX.Element {
  if (initialItems.length === 0) {
    return (
      <EmptyState
        title="还没有参与任何活动"
        desc="报名参加一场活动，让你的作品被更多人看到。"
        action={
          <Link className="btn btn-primary" href="/campaigns">
            浏览活动
          </Link>
        }
      />
    );
  }

  return (
    <div className="dash-joined">
      {initialItems.map((item) => {
        const campaign = item.campaign;
        return (
          <div key={campaign.id} className="dash-joined__row">
            <div className="dash-joined__thumb" aria-hidden="true">
              <CoverPlaceholder slug={campaign.slug} title={campaign.title} coverUrl={campaign.coverUrl} />
            </div>

            <div className="dash-joined__main">
              <Link className="dash-joined__title" href={`/campaigns/${campaign.slug}`} title={campaign.title}>
                {campaign.title}
              </Link>
              <div className="dash-joined__badges">
                <Badge tone={campaignStatusTone(campaign.status)} dot={campaign.status === 'voting'}>
                  {campaignStatusLabel(campaign.status)}
                </Badge>
              </div>
              <div className="dash-joined__meta">
                {formatDate(campaign.voteEndAt)} 截止 · 我报名了 {item.myProjectCount} 件作品
              </div>
            </div>

            <div className="dash-joined__stats">
              <span className="dash-joined__count">
                {formatCount(item.myCampaignVoteCount)}
                <small>我的作品活动票</small>
              </span>
              <span className="dash-joined__count">
                {formatCount(campaign.voteCount)}
                <small>活动票累计</small>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
