/**
 * 活动时间线（P1 活动模块）。
 *
 * 对齐原型 `.camp-flow`：报名征集 → 投票 → 结束 三段，按当前有效状态高亮
 * （done / active / todo），时间统一按 Asia/Shanghai 展示。
 */

import { CAMPAIGN_STATUS } from '@/lib/constants';
import { formatDateTime } from '@/lib/format';
import type { CampaignDTO } from '@/lib/types';

/** 组件属性。 */
export interface CampaignTimelineProps {
  campaign: CampaignDTO;
}

/** 计算某阶段状态：done（已过）/ active（当前）/ todo（未到）。 */
function phaseState(status: CampaignDTO['status'], phase: 'collect' | 'vote' | 'end'): 'done' | 'active' | 'todo' {
  if (status === CAMPAIGN_STATUS.DRAFT) return phase === 'collect' ? 'active' : 'todo';
  if (status === CAMPAIGN_STATUS.COLLECTING) return phase === 'collect' ? 'active' : 'todo';
  if (status === CAMPAIGN_STATUS.VOTING) {
    if (phase === 'collect') return 'done';
    if (phase === 'vote') return 'active';
    return 'todo';
  }
  // ended：全部完成
  return 'done';
}

/** 渲染活动时间线。 */
export function CampaignTimeline({ campaign }: CampaignTimelineProps): React.JSX.Element {
  const voteWindow =
    campaign.voteStartAt && campaign.voteEndAt
      ? `${formatDateTime(campaign.voteStartAt)} → ${formatDateTime(campaign.voteEndAt)}`
      : formatDateTime(campaign.voteEndAt);

  const steps = [
    {
      key: 'collect',
      label: '报名征集',
      time: formatDateTime(campaign.collectEndAt),
      state: phaseState(campaign.status, 'collect'),
    },
    {
      key: 'vote',
      label: '投票',
      time: voteWindow,
      state: phaseState(campaign.status, 'vote'),
    },
    {
      key: 'end',
      label: '结束',
      time: formatDateTime(campaign.voteEndAt),
      state: phaseState(campaign.status, 'end'),
    },
  ] as const;

  return (
    <div className="camp-flow" role="list" aria-label="活动时间线">
      {steps.map((step, index) => (
        <div key={step.key} className="camp-flow__part" role="listitem">
          <div className="camp-flow__step" data-state={step.state}>
            <span className="camp-flow__dot" aria-hidden="true" />
            <div className="camp-flow__label">{step.label}</div>
            <div className="camp-flow__time">{step.time}</div>
          </div>
          {index < steps.length - 1 ? <span className="camp-flow__line" aria-hidden="true" /> : null}
        </div>
      ))}
    </div>
  );
}
