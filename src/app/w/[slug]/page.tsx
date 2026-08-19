/**
 * 作品详情页 `/w/{slug}`。
 *
 * 服务端直接调领域服务（不绕一圈 HTTP 打自家 API）：少一次网络往返，
 * 也免去在 Server Component 里拼绝对地址的麻烦。
 *
 * 归档作品重定向到状态页，PRIVATE / 不存在统一 notFound()。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  FavoriteButton,
  MobileVoteBar,
  PreviewFrame,
  ProjectMetaPanel,
  ShareCard,
  VoteHero,
} from '@/components/project';
import { Avatar, Badge } from '@/components/ui';
import { getSession } from '@/lib/auth';
import * as campaignService from '@/lib/campaign-service';
import { PROJECT_STATUS, SITE_URL } from '@/lib/constants';
import * as favoriteService from '@/lib/favorite-service';
import { formatCount, truncate } from '@/lib/format';
import * as projectService from '@/lib/project-service';
import { buildSandboxUrl, displayShortLink } from '@/lib/sandbox';
import { resolveProjectDir } from '@/lib/storage';
import * as voteService from '@/lib/vote-service';

export const dynamic = 'force-dynamic';

/** 页面参数。 */
type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = await projectService.peek(slug);

  if (!project || project.visibility === 'PRIVATE') {
    return { title: '作品不存在' };
  }

  return {
    title: project.title,
    description: project.summary ?? truncate(project.description ?? '', 120),
    openGraph: {
      title: project.title,
      description: project.summary ?? undefined,
      type: 'article',
      // P3 分享：指向确定性渐变封面（同一 slug 永远同一张图）。
      // 生产化：SITE_URL 环境变量指向正式域名即可（默认 http://localhost:3000）。
      images: [
        {
          url: `${SITE_URL}/api/covers/${slug}.svg`,
          width: 1200,
          height: 750,
          alt: project.title,
        },
      ],
    },
    // 作品页不进搜索引擎，避免用户上传内容影响站点权重
    robots: { index: false, follow: false },
  };
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const project = await projectService.peek(slug);

  if (
    !project ||
    project.status === PROJECT_STATUS.PURGED ||
    project.status === PROJECT_STATUS.BLOCKED
  ) {
    notFound();
  }
  if (project.visibility === 'PRIVATE') {
    // 与不存在表现一致，不泄漏存在性
    notFound();
  }
  if (project.status === PROJECT_STATUS.ARCHIVED) {
    redirect(`/_status/${slug}`);
  }

  const isExternal = project.sourceType === 'EXTERNAL_URL';
  const targetUrl = isExternal ? (project.externalUrl ?? '') : buildSandboxUrl(slug);
  const shareText = isExternal
    ? targetUrl.replace(/^https?:\/\//, '')
    : displayShortLink(slug);

  // 登录态 + 是否已投 + 是否已收藏（详情页 SSR 一次拿全，客户端只需本地状态切换）
  const session = await getSession();
  const hasVoted = session ? await voteService.hasVoted(project.id, session.userId) : false;
  const hasFavorited = session ? await favoriteService.hasFavorited(project.id, session.userId) : false;

  // P1 活动模块：所属活动 badge（非 draft，≤2 个 +「+N」）
  const campaignBadges = await campaignService.getProjectCampaigns(project.id);
  const visibleBadges = campaignBadges.slice(0, 2);
  const extraCount = Math.max(0, campaignBadges.length - 2);

  return (
    <>
      <div className="container-max">
        <nav className="breadcrumb" aria-label="面包屑">
        <Link href="/">作品广场</Link>
        <span aria-hidden="true">/</span>
        <span>{project.title}</span>
      </nav>

      <header className="detail__head">
        <div>
          <h1 className="detail__title">{project.title}</h1>
          {project.summary ? <p className="detail__summary">{project.summary}</p> : null}
        </div>

        <div className="detail__meta">
          <span className="detail__author">
            <Avatar name={project.authorName} />
            {project.authorName}
          </span>
          <span aria-hidden="true">·</span>
          <span>{formatCount(project.viewCount)} 次浏览</span>
          <span aria-hidden="true">·</span>
          <Badge tone={project.status === 'ACTIVE' ? 'live' : 'archived'} dot>
            {project.status === 'ACTIVE' ? '在线' : '已归档'}
          </Badge>
          {project.visibility === 'UNLISTED' ? <Badge tone="unlisted">不公开</Badge> : null}
          {visibleBadges.length > 0 ? (
            <span className="detail__campaigns" aria-label="所属活动">
              {visibleBadges.map((badge) => (
                <Link key={badge.id} href={`/campaigns/${badge.slug}`} title={badge.title}>
                  <Badge tone="campaign">{badge.title}</Badge>
                </Link>
              ))}
              {extraCount > 0 ? <Badge tone="campaign">+{extraCount}</Badge> : null}
            </span>
          ) : null}
        </div>
      </header>

      <div className="detail">
        <section className="detail__main" aria-label="作品预览">
          {isExternal ? (
            <div className="detail__external">
              <h2 className="t-title">这是一件外链作品</h2>
              <p className="muted">
                内容托管在站外，Kernel 不代为存储、也不做沙箱隔离，请自行确认来源可信。
              </p>
              <p className="linkbox">
                <span title={targetUrl}>{targetUrl}</span>
              </p>
              <a
                className="btn btn-primary"
                href={targetUrl}
                target="_blank"
                rel="noopener noreferrer external"
              >
                前往访问
              </a>
            </div>
          ) : (
            <PreviewFrame src={targetUrl} displayUrl={displayShortLink(slug)} title={project.title} />
          )}

          {project.description ? (
            <div className="detail__desc">
              <h2 className="t-title">作品介绍</h2>
              {/* P0 按纯文本渲染，不解析 Markdown —— 避免引入 XSS 面 */}
              <p className="prewrap">{project.description}</p>
            </div>
          ) : null}

          {project.screenshots.length > 0 ? (
            <div className="detail__shots">
              <h2 className="t-title">作品截图</h2>
              <div className="shot-gallery">
                {project.screenshots.map((file, index) => (
                  <a key={file} href={`/api/screenshots/${file}`} target="_blank" rel="noopener noreferrer" className="shot-gallery__item">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/screenshots/${file}`} alt={`${project.title} 截图 ${index + 1}`} loading="lazy" decoding="async" />
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <aside className="detail__side" aria-label="作品信息与操作">
          {/* P3 收藏：与「投一票」并列（同一操作区，星形图标区分投票爱心） */}
          <div className="vote-hero-stack">
            <VoteHero
              slug={slug}
              projectId={project.id}
              voteCount={project.voteCount}
              hasVoted={hasVoted}
              isLoggedIn={session !== null}
            />
            <FavoriteButton
              slug={slug}
              initialFavorited={hasFavorited}
              isLoggedIn={session !== null}
              loginNext={`/w/${slug}`}
              variant="inline"
            />
            <span className="muted t-body-sm" title="收藏数">
              {formatCount(project.favoriteCount)} 人收藏
            </span>
          </div>

          <ShareCard
            url={targetUrl}
            displayUrl={shareText}
            poster={{ title: project.title, slug }}
          />

          <ProjectMetaPanel
            project={project}
            dirPath={isExternal ? null : resolveProjectDir(slug)}
          />
        </aside>
      </div>
      </div>

      {/* P3 移动端吸底投票条（≤768px 显示，复用详情页 SSR 已拿到的数据） */}
      <MobileVoteBar
        projectId={project.id}
        voteCount={project.voteCount}
        hasVoted={hasVoted}
        isLoggedIn={session !== null}
        loginNext={`/w/${slug}`}
      />
    </>
  );
}
