/**
 * 排行榜 `/rank` —— 全站票数总榜 + 活动榜（P1 活动模块）。
 *
 * 数据源：
 *   - `scope=global`（缺省）：`projectService.rank()`（PUBLIC + ACTIVE + voteCount > 0，
 *     按票数倒序；含活动票）；
 *   - `scope=campaign&campaign={slug}`：`campaignService.rank()`（活动内票数 desc、
 *     joinedAt asc），活动榜头展示活动名与截止时间。
 *
 * 视觉真源：prototype `#view-rank` + DESIGN.md §4.6 / §9 ③。
 *
 * P0-A 性能优化：rank 页无 session 依赖（纯公开数据），改为 ISR 5 分钟缓存，
 * 避免每次请求都查 DB。revalidate=300 秒后自动重新生成。
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { RankScopeFilter } from '@/components/campaign';
import { CoverPlaceholder } from '@/components/project';
import * as campaignService from '@/lib/campaign-service';
import { formatCount, formatDate } from '@/lib/format';
import * as projectService from '@/lib/project-service';
import type { CampaignRankItemDTO, ProjectDTO } from '@/lib/types';

/** ISR：5 分钟重新验证一次，替代 force-dynamic。 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: '排行榜',
  description: '全站票数总榜与活动内排名，看看哪些作品正在被大家点亮。',
  openGraph: {
    title: '排行榜',
    description: '全站票数总榜与活动内排名，看看哪些作品正在被大家点亮。',
    type: 'website',
    siteName: 'Kernel · 创意种子',
    locale: 'zh_CN',
  },
};

/** 单页条数。 */
const RANK_PAGE_LIMIT = 12;

/** 前三名奖牌色调，与 globals.css `.medal--*` 一一对应。 */
const MEDAL_TONE: readonly ('gold' | 'silver' | 'bronze')[] = ['gold', 'silver', 'bronze'];

/** 页面参数（Next 15 起 searchParams 为 Promise）。 */
type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** 从 searchParams 取单值字符串。 */
function single(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** 页面头部：实时徽章 + 标题 + 副文案。 */
function RankHead({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="rank-head">
      <div>
        <span className="badge badge--live">
          <span className="dot dot-live is-pulse" aria-hidden="true" />
          实时更新
        </span>
        <h1 className="rank-head__title">{title}</h1>
        <p className="rank-head__sub">{sub}</p>
      </div>
    </header>
  );
}

/** 领奖台卡片（单件）：奖牌 + 封面缩略 + 标题 + 作者 + 票数，整块可点。 */
function PodiumItem({ rank, project }: { rank: number; project: ProjectDTO }) {
  return (
    <Link className={`podium-item podium-item--${rank}`} href={project.detailUrl}>
      <span className={`medal medal--${MEDAL_TONE[rank - 1]} podium-item__medal`} aria-label={`第 ${rank} 名`}>
        {rank}
      </span>
      <CoverPlaceholder
        slug={project.slug}
        title={project.title}
        coverUrl={project.coverUrl}
        className="podium-item__thumb"
      />
      <div className="podium-item__body">
        <h3 className="podium-item__title">{project.title}</h3>
        <div className="podium-item__meta">
          <span className="podium-item__author">{project.authorName}</span>
          <span className="podium-item__votes">
            <b>{formatCount(project.voteCount)}</b>
            <small>票</small>
          </span>
        </div>
      </div>
    </Link>
  );
}

/** 榜单行（第 4 名起）：排名 + 封面小图 + 标题/作者 + 票数，整行可点。 */
function RankRow({ rank, project }: { rank: number; project: ProjectDTO }) {
  return (
    <Link className="ranklist-row" href={project.detailUrl}>
      <span className="ranklist__rank">{rank}</span>
      <CoverPlaceholder
        slug={project.slug}
        title={project.title}
        coverUrl={project.coverUrl}
        className="ranklist__thumb"
      />
      <div className="ranklist__main">
        <div className="ranklist__title">{project.title}</div>
        <div className="ranklist__meta">{project.authorName}</div>
      </div>
      <div className="ranklist__votes">
        <b>{formatCount(project.voteCount)}</b>
        <small>票</small>
      </div>
    </Link>
  );
}

/** 活动榜行：活动内票数 + 报名时间。 */
function CampaignRankRow({ rank, item }: { rank: number; item: CampaignRankItemDTO }) {
  return (
    <Link className="ranklist-row" href={item.project.detailUrl}>
      <span className="ranklist__rank">{rank}</span>
      <CoverPlaceholder
        slug={item.project.slug}
        title={item.project.title}
        coverUrl={item.project.coverUrl}
        className="ranklist__thumb"
      />
      <div className="ranklist__main">
        <div className="ranklist__title">{item.project.title}</div>
        <div className="ranklist__meta">{item.project.authorName} · 报名于 {formatDate(item.joinedAt)}</div>
      </div>
      <div className="ranklist__votes">
        <b>{formatCount(item.campaignVoteCount)}</b>
        <small>活动票</small>
      </div>
    </Link>
  );
}

/** 总榜视图。 */
function GlobalRankView({ items }: { items: ProjectDTO[] }) {
  const totalVotes = items.reduce((sum, project) => sum + project.voteCount, 0);

  // 领奖台：数据顺序为 1/2/3，视觉顺序为 2/1/3（第一名居中、左右为二三名）
  const top3 = items.slice(0, 3);
  const podium =
    top3.length === 3
      ? [
          { rank: 2, project: top3[1] },
          { rank: 1, project: top3[0] },
          { rank: 3, project: top3[2] },
        ]
      : top3.map((project, index) => ({ rank: index + 1, project }));

  const rest = items.slice(3);

  return (
    <>
      <RankHead
        title="排行榜"
        sub={`共 ${formatCount(items.length)} 件上榜作品 · 累计 ${formatCount(totalVotes)} 票`}
      />
      {items.length === 0 ? (
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
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
              <path d="M4 22h16" />
              <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
              <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
              <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
            </svg>
          </div>
          <h2 className="t-headline">还没有作品获得投票</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            快去广场为喜欢的作品投出第一票，榜单会实时更新。
          </p>
          <div className="empty__actions" style={{ marginTop: 18 }}>
            <Link className="btn btn-primary" href="/">
              回到作品广场
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="podium" role="list" aria-label="排行榜前三名">
            {podium.map(({ rank, project }) => (
              <PodiumItem key={project.id} rank={rank} project={project} />
            ))}
          </div>
          {rest.length > 0 ? (
            <div className="ranklist">
              {rest.map((project, index) => (
                <RankRow key={project.id} rank={index + 4} project={project} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

/** 活动榜视图。 */
function CampaignRankView({
  slug,
  campaignTitle,
  campaignVoteEndAt,
  items,
}: {
  slug: string;
  campaignTitle: string;
  campaignVoteEndAt: string | null;
  items: CampaignRankItemDTO[];
}) {
  const head =
    campaignTitle !== ''
      ? `${campaignTitle} · 投票截止 ${formatDate(campaignVoteEndAt)}`
      : `活动「${slug}」内排名`;

  return (
    <>
      <RankHead title="活动榜" sub={head} />
      {items.length === 0 ? (
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
          <h2 className="t-headline">该活动还没有作品上榜</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            作品报名并收到活动票后，会按票数实时上榜。
          </p>
          <div className="empty__actions" style={{ marginTop: 18 }}>
            <Link className="btn btn-primary" href={`/campaigns/${slug}`}>
              查看活动详情
            </Link>
          </div>
        </div>
      ) : (
        <div className="ranklist" style={{ marginTop: 28 }}>
          {items.map((item, index) => (
            <CampaignRankRow key={item.project.id} rank={item.rank} item={item} />
          ))}
        </div>
      )}
    </>
  );
}

/** 榜单页：scope 切换 + 活动榜筛选（仅 voting/ended 可筛）。 */
export default async function RankPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const scope = single(sp.scope) === 'campaign' ? 'campaign' : 'global';
  const campaignSlug = single(sp.campaign).trim();

  const [selectable, globalItems] = await Promise.all([
    campaignService.listSelectable(),
    projectService.rank(RANK_PAGE_LIMIT),
  ]);

  // 活动榜：仅在明确请求 scope=campaign 且 slug 存在时渲染
  let campaignView: React.JSX.Element | null = null;
  if (scope === 'campaign' && campaignSlug !== '') {
    const items = await campaignService.rank(campaignSlug, RANK_PAGE_LIMIT);
    const detail = await campaignService.getBySlug(campaignSlug).catch(() => null);
    campaignView = (
      <CampaignRankView
        slug={campaignSlug}
        campaignTitle={detail?.title ?? ''}
        campaignVoteEndAt={detail?.voteEndAt ?? null}
        items={items}
      />
    );
  }

  return (
    <div className="container-wide rank-page">
      <RankScopeFilter
        scope={scope}
        campaignSlug={campaignSlug}
        campaigns={selectable.map((item) => ({ slug: item.slug, title: item.title }))}
      />
      {campaignView ?? <GlobalRankView items={globalItems} />}
    </div>
  );
}
