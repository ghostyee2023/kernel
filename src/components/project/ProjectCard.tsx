/**
 * 广场作品卡片。
 *
 * 整卡是一个 `<Link>`，不再往里嵌第二个 `<a>` —— 嵌套锚点是非法 HTML，
 * 读屏也会读出两个重叠的可点区域。需要「新窗口打开」时到详情页去点。
 *
 * P3 收藏：可选 `favorited` 等 props（缺省不渲染收藏按钮，既有调用方零改动）。
 * 收藏按钮作为 `card__badges` 的**同级兄弟**渲染（不嵌进整卡 Link，避免非法嵌套），
 * 绝对定位在卡片右上角（`.fav-overlay`，z-index 高于 Link）。
 */

import Link from 'next/link';

import { Avatar, Badge, Card } from '@/components/ui';
import { formatBytes, formatCount } from '@/lib/format';
import type { ProjectDTO } from '@/lib/types';

import { CoverPlaceholder } from './CoverPlaceholder';
import { ExpiryBadge } from './ExpiryBadge';
import { FavoriteButton } from './FavoriteButton';

/** 组件属性。 */
export interface ProjectCardProps {
  project: ProjectDTO;
  /** P3 收藏：是否已收藏；缺省不渲染收藏按钮（既有调用方零改动）。 */
  favorited?: boolean;
  /** P3 收藏：当前用户是否已登录（false 时点击跳登录）。 */
  isLoggedIn?: boolean;
  /**
   * P1 流式：显式开启收藏按钮渲染（即使未传 favorited）。
   * 登录用户由客户端挂载后批量解析星标；匿名访客渲染空星（点击跳登录）。
   */
  showFavorites?: boolean;
  /** P3 收藏：登录回跳地址（缺省 /w/{slug}）。 */
  favoriteLoginNext?: string;
}

/** 渲染单张作品卡片。 */
export function ProjectCard({
  project,
  favorited,
  isLoggedIn = false,
  showFavorites = false,
  favoriteLoginNext,
}: ProjectCardProps) {
  // P1 流式：显式开启（showFavorites）或 SSR 传入收藏态（favorited）时才渲染星标；
  // 登录态且无 SSR 收藏态 → 客户端挂载后批量解析（先出壳后补星标）。
  const showFavorite = showFavorites || favorited !== undefined;

  return (
    <Card as="article" className="card--project">
      {/* 徽章绝对定位在封面左上角（.card 为定位上下文），故放在链接外层 */}
      <div className="card__badges">
        <ExpiryBadge expireAt={project.expireAt} archived={project.status === 'ARCHIVED'} />
        {project.visibility === 'UNLISTED' ? <Badge tone="unlisted">不公开</Badge> : null}
      </div>

      {/* P3 收藏：右上角 hover 星标（与 card__badges 同级兄弟，不嵌进 Link） */}
      {showFavorite ? (
        <FavoriteButton
          slug={project.slug}
          initialFavorited={favorited ?? false}
          isLoggedIn={isLoggedIn}
          loginNext={favoriteLoginNext ?? `/w/${project.slug}`}
          variant="overlay"
          resolveClient={isLoggedIn && favorited === undefined}
        />
      ) : null}

      <Link
        href={`/w/${project.slug}`}
        className="card__link"
        aria-label={`查看作品 ${project.title}`}
      >
        <CoverPlaceholder slug={project.slug} title={project.title} coverUrl={project.coverUrl} screenshots={project.screenshots} />

        <div className="card__body">
          <h3 className="card__title">{project.title}</h3>
          <p className="card__desc">{project.summary ?? '这件作品还没有写简介。'}</p>

          {project.tags.length > 0 ? (
            <div className="card__tags" aria-label="标签">
              {project.tags.slice(0, 3).map((tag) => (
                <span key={tag.id} className="card__tag">
                  #{tag.name}
                </span>
              ))}
              {project.tags.length > 3 ? <span className="card__tag card__tag--more">+{project.tags.length - 3}</span> : null}
            </div>
          ) : null}

          <div className="card__foot">
            <span className="card__author">
              <Avatar name={project.authorName} />
              <span>{project.authorName}</span>
            </span>

            <span className="card__stats">
              <span title="收藏数" className="fav-count">
                ★ {formatCount(project.favoriteCount)}
              </span>
              <span aria-hidden="true">·</span>
              <span title="浏览量">{formatCount(project.viewCount)}</span>
              <span aria-hidden="true">·</span>
              <span title="体积">{formatBytes(project.sizeBytes)}</span>
            </span>
          </div>
        </div>
      </Link>
    </Card>
  );
}
