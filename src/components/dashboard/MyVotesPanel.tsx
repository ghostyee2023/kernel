/**
 * 我的投票（P3.5）—— Server Component 双栏。
 *
 * 设计真源：docs/P3-我的后台设计.md §1.5；视觉基准：prototype #view-dashboard（1742-1755 行）。
 * - 左「我投出的票」：myVotesFull（**含作废票**）—— 作品标题 / 活动徽章（null=全站）/
 *   投票时间 / 作废徽章（tone=blocked + title=invalidReason）；PURGED/BLOCKED/PRIVATE 纯文本防死链；
 * - 右「我收到的票」：votesReceivedByProject —— 有效票按 作品×活动 聚合（合计 = KPI 累计票数）；
 *   campaignId=null 显示「全站赞」徽章；
 * - 空态：左「你还没有投出过票」；右「你的作品还没有收到票」。
 */

import Link from 'next/link';

import { Badge, EmptyState } from '@/components/ui';
import { PROJECT_STATUS, VISIBILITY } from '@/lib/constants';
import { formatCount, formatDateTime } from '@/lib/format';
import type { MyVoteFullDTO, ReceivedVoteDTO } from '@/lib/types';

/** 组件属性。 */
export interface MyVotesPanelProps {
  /** 我投出的票（含作废票，createdAt desc）。 */
  votesOut: MyVoteFullDTO[];
  /** 我收到的票（按 作品×活动 聚合）。 */
  votesIn: ReceivedVoteDTO[];
}

/** 标题死链防护：PURGED / BLOCKED / PRIVATE 不产生链接（与 MyProjectsPanel 规则一致）。 */
function canLink(status: string, visibility: string): boolean {
  return (
    status !== PROJECT_STATUS.PURGED &&
    status !== PROJECT_STATUS.BLOCKED &&
    visibility !== VISIBILITY.PRIVATE
  );
}

/** 渲染我的投票双栏。 */
export function MyVotesPanel({ votesOut, votesIn }: MyVotesPanelProps): React.JSX.Element {
  const receivedTotal = votesIn.reduce((sum, vote) => sum + vote.voteCount, 0);

  return (
    <div>
      <div className="dash-page-head">
        <h1 className="t-title" style={{ margin: 0 }}>
          我的投票
        </h1>
        <p className="t-body-sm muted" style={{ marginTop: 3 }}>
          查看你投出的票，以及你的作品收到的票
        </p>
      </div>

      <div className="myvotes-grid">
        {/* 左栏 · 我投出的票（含作废票） */}
        <div className="panel">
          <div className="panel__head">
            <h3>
              我投出的票 <Badge tone="private">{formatCount(votesOut.length)}</Badge>
            </h3>
          </div>
          <div className="panel__body">
            {votesOut.length === 0 ? (
              <EmptyState
                title="你还没有投出过票"
                desc="去广场看看，给你喜欢的作品投一票。"
                action={
                  <Link className="btn btn-primary" href="/">
                    逛逛广场
                  </Link>
                }
              />
            ) : (
              <ul className="myvotes-list">
                {votesOut.map((vote) => {
                  const linkable = canLink(vote.project.status, vote.project.visibility);
                  return (
                    <li key={vote.id} className="myvotes-item">
                      {linkable ? (
                        <Link className="myvotes-item__title" href={`/w/${vote.project.slug}`} title={vote.project.title}>
                          {vote.project.title}
                        </Link>
                      ) : (
                        <span className="myvotes-item__title" title={vote.project.title}>
                          {vote.project.title}
                        </span>
                      )}
                      <div className="myvotes-item__meta">
                        <Badge tone={vote.campaignId ? 'campaign' : 'live'}>
                          {vote.campaignTitle ?? '全站'}
                        </Badge>
                        {!vote.valid ? (
                          <Badge tone="blocked" title={vote.invalidReason ?? '该票已被管理员作废'}>
                            已作废
                          </Badge>
                        ) : null}
                        <span>{formatDateTime(vote.createdAt)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* 右栏 · 我收到的票（按 作品×活动 聚合） */}
        <div className="panel">
          <div className="panel__head">
            <h3>
              我收到的票 <Badge tone="live">{formatCount(receivedTotal)}</Badge>
            </h3>
          </div>
          <div className="panel__body">
            {receivedTotal === 0 ? (
              <EmptyState
                title="你的作品还没有收到票"
                desc="作品被更多人看到后，这里会展示收到的有效票数。"
              />
            ) : (
              <ul className="myvotes-list">
                {votesIn.map((vote) => (
                  <li key={`${vote.projectId}-${vote.campaignId ?? 'site'}`} className="myvotes-item">
                    <Link className="myvotes-item__title" href={`/w/${vote.slug}`} title={vote.title}>
                      {vote.title}
                    </Link>
                    <div className="myvotes-item__meta">
                      <Badge tone={vote.campaignId ? 'campaign' : 'live'}>
                        {vote.campaignTitle ?? '全站赞'}
                      </Badge>
                      <span className="myvotes-item__votes">{formatCount(vote.voteCount)} 票</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
