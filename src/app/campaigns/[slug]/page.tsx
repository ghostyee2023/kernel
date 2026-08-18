/**
 * 活动详情 `/campaigns/[slug]`（P1 活动模块）。
 *
 * Server Component 直调 `campaignService.getBySlug()` + 登录态下
 * `myProjects` / `myJoinedIds` / `quota` / `myVotes`，一次取全：
 * 规则 + 时间线 + 数字卡 + 已报名作品网格（每件含活动内票数 + CampaignVoteButton）
 * + 报名区（CampaignJoinBox）。
 *
 * draft / 不存在 → 统一 notFound()（不泄漏存在性）。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  CampaignJoinBox,
  CampaignTimeline,
  CampaignVoteButton,
  campaignStatusLabel,
  campaignStatusTone,
} from '@/components/campaign';
import { CoverPlaceholder, MobileVoteBar } from '@/components/project';
import { Badge } from '@/components/ui';
import { getSession } from '@/lib/auth';
import * as campaignService from '@/lib/campaign-service';
import { CAMPAIGN_STATUS, SITE_URL } from '@/lib/constants';
import { formatCount, formatDate } from '@/lib/format';
import { AppError, ERROR_CODE } from '@/lib/response';
import type { CampaignDetailDTO } from '@/lib/types';
import * as voteService from '@/lib/vote-service';

export const dynamic = 'force-dynamic';

/** 页面参数。 */
type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const detail = await campaignService.getBySlug(slug);
    return {
      title: detail.title,
      description: detail.description ?? undefined,
      openGraph: {
        title: detail.title,
        description: detail.description ?? undefined,
        type: 'website',
        // P3 分享：指向确定性渐变活动封面（同一 slug 永远同一张图）。
        // 生产化：SITE_URL 环境变量指向正式域名即可（默认 http://localhost:3000）。
        images: [
          {
            url: `${SITE_URL}/api/covers/${slug}.svg`,
            width: 1200,
            height: 750,
            alt: detail.title,
          },
        ],
      },
    };
  } catch {
    return { title: '活动不存在' };
  }
}

/** 渲染活动详情页。 */
export default async function CampaignDetailPage({ params }: PageProps): Promise<React.JSX.Element> {
  const { slug } = await params;

  let detail: CampaignDetailDTO;
  try {
    detail = await campaignService.getBySlug(slug);
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODE.CAMP_NOT_FOUND) notFound();
    throw error;
  }

  // 登录态 SSR 一次取全：我的可报名作品 / 我已报名作品 / 剩余票 / 我已投作品。
  // 四个 per-user 查询无依赖，用 Promise.all 并行，避免串行 await 把首屏 TTFB 拖长 4 倍。
  const session = await getSession();
  let myProjects: Awaited<ReturnType<typeof campaignService.myProjects>> = [];
  let myJoinedIds: Awaited<ReturnType<typeof campaignService.myJoinedIds>> = [];
  let quotaInfo: Awaited<ReturnType<typeof campaignService.quota>> | null = null;
  let myVotedIds: string[] = [];
  if (session) {
    [myProjects, myJoinedIds, quotaInfo, myVotedIds] = await Promise.all([
      campaignService.myProjects(session.userId, detail.id),
      campaignService.myJoinedIds(session.userId, detail.id),
      campaignService.quota(slug, session.userId),
      voteService.myVotes(session.userId).then((votes) => votes.map((vote) => vote.projectId)),
    ]);
  }

  const now = Date.now();
  const canJoin =
    detail.status === CAMPAIGN_STATUS.COLLECTING &&
    detail.collectEndAt !== null &&
    new Date(detail.collectEndAt).getTime() > now;

  // P1 补：结果不可见（ended + resultVisible=false）→ 票数/排名对外隐藏
  const resultHidden = detail.status === CAMPAIGN_STATUS.ENDED && !detail.resultVisible;

  const remainingQuota = quotaInfo?.remaining ?? detail.maxVotesPerUser;

  // P3 移动端吸底投票条：仅单作品活动（投票目标无歧义；多作品时各作品已有独立投票按钮）
  const barProject = detail.projects.length === 1 ? detail.projects[0] : null;

  return (
    <>
      <div className="container-max camp-detail">
        <nav className="breadcrumb" aria-label="面包屑">
        <Link href="/">作品广场</Link>
        <span aria-hidden="true">/</span>
        <Link href="/campaigns">活动广场</Link>
        <span aria-hidden="true">/</span>
        <span>{detail.title}</span>
      </nav>

      <header className="camp-detail__head">
        <div>
          <div className="camp-detail__meta">
            <Badge tone={campaignStatusTone(detail.status)}>{campaignStatusLabel(detail.status)}</Badge>
            <Badge tone={detail.activityType === 'OFFLINE' ? 'expiring' : 'campaign'}>
              {detail.activityType === 'OFFLINE' ? '线下活动' : '线上活动'}
            </Badge>
            <span className="mono">{detail.slug}</span>
          </div>
          <h1 className="camp-detail__title">{detail.title}</h1>
          {detail.description ? <p className="camp-detail__summary">{detail.description}</p> : null}
        </div>
      </header>

      <div className="camp-detail__body">
        <section className="camp-detail__main" aria-label="活动内容">
          <div className="camp-banner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={detail.coverUrl && detail.coverUrl.trim() !== '' ? detail.coverUrl : `/api/covers/${detail.slug}.svg`}
              alt={`${detail.title} 的活动封面`}
            />
          </div>

          <CampaignTimeline campaign={detail} />

          <div className="camp-stats">
            <div className="camp-stat">
              <div className="camp-stat__num">{formatCount(detail.projectCount)}</div>
              <div className="camp-stat__label">已报名作品</div>
            </div>
            {resultHidden ? (
              <div className="camp-stat camp-stat--muted">
                <div className="camp-stat__num">—</div>
                <div className="camp-stat__label">结果未公开</div>
              </div>
            ) : (
              <div className="camp-stat">
                <div className="camp-stat__num">{formatCount(detail.voteCount)}</div>
                <div className="camp-stat__label">活动累计票</div>
              </div>
            )}
          </div>

          {resultHidden ? (
            <p className="camp-result-hidden" role="status">
              活动已结束，投票结果暂未公开，请等待主办方公布。
            </p>
          ) : null}

          {session && detail.status === CAMPAIGN_STATUS.VOTING ? (
            <div className="camp-quota-row">
              <span className="camp-quota">
                我的剩余票数
                <b>
                  {remainingQuota} / {detail.maxVotesPerUser}
                </b>
              </span>
              {!detail.allowSelfVote ? <span className="camp-quota-note">本活动不支持给自己投票</span> : null}
            </div>
          ) : null}

          <div className="camp-proj-list">
            <h2 className="t-title">已报名作品</h2>
            {detail.projects.length === 0 ? (
              <p className="muted">还没有作品报名，快来做第一个吧。</p>
            ) : (
              <div className="camp-proj-stack">
                {detail.projects.map((item) => (
                  <div className="camp-proj" key={item.project.id}>
                    <Link className="camp-proj__main" href={item.project.detailUrl}>
                      <CoverPlaceholder
                        slug={item.project.slug}
                        title={item.project.title}
                        coverUrl={item.project.coverUrl}
                        className="camp-proj__thumb"
                      />
                      <div className="camp-proj__body">
                        <div className="camp-proj__title" title={item.project.title}>
                          {item.project.title}
                        </div>
                        <div className="camp-proj__author">{item.project.authorName}</div>
                        <div className="camp-proj__badges">
                          {myJoinedIds.includes(item.project.id) ? <Badge tone="campaign">已报名</Badge> : null}
                          {myVotedIds.includes(item.project.id) ? <Badge tone="live">已投</Badge> : null}
                        </div>
                      </div>
                    </Link>
                    <div className="camp-proj__votes">
                      {resultHidden ? (
                        <div className="camp-proj__count muted">结果未公开</div>
                      ) : (
                        <>
                          <div className="camp-proj__count">
                            {formatCount(item.campaignVoteCount)} <small>活动票</small>
                          </div>
                          <CampaignVoteButton
                            campaignSlug={slug}
                            campaignId={detail.id}
                            projectId={item.project.id}
                            campaignVoteCount={item.campaignVoteCount}
                            hasVoted={myVotedIds.includes(item.project.id)}
                            isLoggedIn={session !== null}
                            remainingQuota={remainingQuota}
                            selfVoteForbidden={!detail.allowSelfVote && item.project.authorId === session?.userId}
                          />
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="camp-detail__side" aria-label="报名与规则">
          <div className="side-card">
            <h3 className="side-card__title">报名参加</h3>
            <CampaignJoinBox
              campaignSlug={slug}
              canJoin={canJoin}
              isLoggedIn={session !== null}
              myProjects={myProjects}
              joinedCount={detail.projectCount}
            />
          </div>

          <div className="side-card">
            <h3 className="side-card__title">活动规则</h3>
            <div className="camp-rules">
              <div className="meta-row">
                <span className="k">每人限投</span>
                <span className="v mono">{detail.maxVotesPerUser} 票</span>
              </div>
              <div className="meta-row">
                <span className="k">允许自投</span>
                <span className="v">{detail.allowSelfVote ? '是' : '否'}</span>
              </div>
              <div className="meta-row">
                <span className="k">计票权重</span>
                <span className="v mono">×{detail.voteWeight}</span>
              </div>
              <div className="meta-row">
                <span className="k">报名截止</span>
                <span className="v">{formatDate(detail.collectEndAt)}</span>
              </div>
              <div className="meta-row">
                <span className="k">投票截止</span>
                <span className="v">{formatDate(detail.voteEndAt)}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
      </div>

      {/* P3 移动端吸底投票条（≤768px 显示；单作品 + 投票期才渲染） */}
      {barProject && detail.status === CAMPAIGN_STATUS.VOTING ? (
        <MobileVoteBar
          projectId={barProject.project.id}
          voteCount={barProject.campaignVoteCount}
          hasVoted={myVotedIds.includes(barProject.project.id)}
          isLoggedIn={session !== null}
          loginNext={`/campaigns/${slug}`}
          campaignId={detail.id}
          remainingQuota={remainingQuota}
          selfVoteForbidden={!detail.allowSelfVote && barProject.project.authorId === session?.userId}
        />
      ) : null}
    </>
  );
}
