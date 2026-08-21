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

import { Avatar, Badge } from '@/components/ui';
import { VoteFavoriteBlock } from '@/components/project/VoteFavoriteBlock';
import { WorkPreview } from '@/components/project/WorkPreview';
import { MobileVoteBar, ProjectMetaPanel, ShareCard } from '@/components/project';
import { canManageProject, getSession } from '@/lib/auth';
import * as campaignService from '@/lib/campaign-service';
import { PROJECT_STATUS, SITE_URL } from '@/lib/constants';
import * as favoriteService from '@/lib/favorite-service';
import { describeExpiry, formatCount, formatDate, formatDateTime, truncate } from '@/lib/format';
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

  // 到期提醒：仅当临近（≤7 天或已过期）时显示
  const expiry = describeExpiry(project.expireAt);
  const expireNotice =
    expiry.tone !== 'live'
      ? `本作品将于 ${formatDateTime(project.expireAt)} 到期，到期后将转为归档状态。`
      : null;

  return (
    <>
      <div className="container-max">
        <nav className="breadcrumb" aria-label="面包屑">
          <Link href="/">作品广场</Link>
          <span aria-hidden="true">/</span>
          <span>{project.title}</span>
        </nav>

        {/* —— 头部四层：标题 / 副标题 / byline / 统计 / 到期提醒 —— */}
        <header className="detail-head">
          <h1 className="detail-head__title">{project.title}</h1>
          {project.summary ? <p className="detail-head__sub">{project.summary}</p> : null}

          <div className="detail-head__byline">
            <Avatar name={project.authorName} />
            <span>{project.authorName}</span>

            {visibleBadges.length > 0 ? (
              <>
                <span className="detail-head__sep" aria-hidden="true">·</span>
                {visibleBadges.map((badge) => (
                  <Link key={badge.id} href={`/campaigns/${badge.slug}`} title={badge.title}>
                    <Badge tone="campaign">{badge.title}</Badge>
                  </Link>
                ))}
                {extraCount > 0 ? <Badge tone="campaign">+{extraCount}</Badge> : null}
              </>
            ) : null}

            {project.visibility === 'UNLISTED' ? <Badge tone="unlisted">不公开</Badge> : null}
            {project.status === 'ACTIVE' ? (
              <Badge tone="live" dot>
                在线
              </Badge>
            ) : null}
          </div>

          <div className="detail-head__stats">
            <span>浏览 {formatCount(project.viewCount)}</span>
            <span>发布 {formatDate(project.createdAt)}</span>
          </div>

          {expireNotice ? (
            <div className="detail-head__notice" role="status">
              <span className="detail-head__notice-dot" aria-hidden="true" />
              <span>{expireNotice}</span>
            </div>
          ) : null}
        </header>

        <div className="detail">
          <section className="detail__main" aria-label="作品预览与介绍">
            {/* 统一预览：截图轮播 / 沙箱运行 切换（外链时展示提示） */}
            <WorkPreview
              screenshots={project.screenshots}
              sandboxUrl={targetUrl}
              displayUrl={displayShortLink(slug)}
              title={project.title}
              isExternal={isExternal}
              externalUrl={targetUrl}
              sharePanelId="work-share-details"
            />

            {/* 作品介绍（紧跟预览，无边框） */}
            {project.description ? (
              <div className="detail__desc">
                <h2 className="t-title">作品介绍</h2>
                {/* P0 按纯文本渲染，不解析 Markdown —— 避免引入 XSS 面 */}
                <p className="prewrap">{project.description}</p>
              </div>
            ) : null}

            {/* 标签区块：介绍下方独立区块；>6 折叠为 +N */}
            {project.tags.length > 0 ? (
              <div className="detail-tags">
                {project.tags.slice(0, 6).map((tag) => (
                  <Link
                    key={tag.id}
                    href={`/?tag=${tag.slug}`}
                    className="detail-tags__tag"
                    title={`查看「${tag.name}」标签的作品`}
                  >
                    #{tag.name}
                  </Link>
                ))}
                {project.tags.length > 6 ? (
                  <span className="detail-tags__tag detail-tags__more" title={`还有 ${project.tags.length - 6} 个标签`}>
                    +{project.tags.length - 6}
                  </span>
                ) : null}
              </div>
            ) : null}
          </section>

          <aside className="detail__side" aria-label="作品信息与操作">
            {/* 投票 + 收藏单卡（全页唯一主行动点 · 品红） */}
            <VoteFavoriteBlock
              slug={slug}
              projectId={project.id}
              voteCount={project.voteCount}
              hasVoted={hasVoted}
              favoriteCount={project.favoriteCount}
              hasFavorited={hasFavorited}
              isLoggedIn={session !== null}
            />

            {/* 立即访问：主色调快捷入口（与预览区底部「立即访问」互为镜像） */}
            <a
              className="visit-btn"
              href={targetUrl}
              target="_blank"
              rel="noopener noreferrer external"
              aria-label={`在新窗口打开作品《${project.title}》`}
              title={targetUrl}
            >
              <span>立即访问</span>
              <span className="visit-btn__arrow" aria-hidden="true">↗</span>
            </a>

            {/* 分享：可折叠（复制链接 · 二维码 · 海报） */}
            <details className="work-share" id="work-share-details">
              <summary className="work-share__summary">
                <span>复制链接 · 二维码</span>
                <svg
                  className="chevron"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </summary>
              <div className="work-share__body">
                <ShareCard
                  url={targetUrl}
                  displayUrl={shareText}
                  poster={{ title: project.title, slug }}
                  boxed={false}
                />
              </div>
            </details>

            {/* 作品信息（短码/文件/体积/可见性等）：仅作者 / 管理员可见 */}
            {canManageProject(session, project) ? (
              <ProjectMetaPanel
                project={project}
                dirPath={isExternal ? null : resolveProjectDir(slug)}
              />
            ) : null}
          </aside>
        </div>
      </div>

      {/* P3 移动端吸底条（≤768px 显示，复用详情页 SSR 已拿到的数据；含收藏） */}
      <MobileVoteBar
        projectId={project.id}
        voteCount={project.voteCount}
        hasVoted={hasVoted}
        isLoggedIn={session !== null}
        loginNext={`/w/${slug}`}
        slug={slug}
        favoriteCount={project.favoriteCount}
        favorited={hasFavorited}
      />
    </>
  );
}
