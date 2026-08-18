/**
 * 活动卡片（P1 活动模块）。
 *
 * 视觉真源：prototype `#view-campaign` 的活动卡片 —— 渐变封面 + 状态徽章 +
 * 标题 + 作品数/票数，整卡可点进入活动详情。
 */

import Link from 'next/link';

import { Badge } from '@/components/ui';
import { formatCount, formatDate } from '@/lib/format';
import type { CampaignCardDTO } from '@/lib/types';

/** 活动状态 → 中文文案。 */
export function campaignStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: '草稿',
    collecting: '征集报名中',
    voting: '投票中',
    ended: '已结束',
  };
  return map[status] ?? status;
}

/** 活动状态 → Badge tone（draft 用灰弱化、collecting 用主色、voting 用绿色、ended 用红色）。 */
export function campaignStatusTone(status: string): 'campaign' | 'live' | 'archived' | 'private' {
  switch (status) {
    case 'voting':
      return 'live';
    case 'collecting':
      return 'campaign';
    case 'ended':
      return 'archived';
    default:
      return 'private';
  }
}

/** 组件属性。 */
export interface CampaignCardProps {
  campaign: CampaignCardDTO;
}

/** 渲染活动卡片。 */
export function CampaignCard({ campaign }: CampaignCardProps): React.JSX.Element {
  const coverSrc =
    campaign.coverUrl && campaign.coverUrl.trim() !== '' ? campaign.coverUrl : `/api/covers/${campaign.slug}.svg`;

  return (
    <Link className="camp-card" href={`/campaigns/${campaign.slug}`} aria-label={`查看活动「${campaign.title}」`}>
      <div className="camp-cover">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={coverSrc} alt={`${campaign.title} 的活动封面`} loading="lazy" decoding="async" />
        <Badge tone={campaignStatusTone(campaign.status)} className="camp-card__status">
          {campaignStatusLabel(campaign.status)}
        </Badge>
      </div>
      <div className="camp-card__body">
        <h3 className="camp-card__title" title={campaign.title}>
          {campaign.title}
        </h3>
        <p className="camp-card__desc">{campaign.description ?? '暂无活动简介'}</p>
        <div className="camp-card__meta">
          <span>
            <b className="mono">{formatCount(campaign.projectCount)}</b> 件作品
          </span>
          <span>
            <b className="mono">{formatCount(campaign.voteCount)}</b> 票
          </span>
          <span className="camp-card__period">{formatDate(campaign.voteEndAt)} 截止</span>
        </div>
      </div>
    </Link>
  );
}
