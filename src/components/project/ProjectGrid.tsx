/**
 * 作品网格。
 *
 * 空态与列表共用一个入口，避免调用方到处写 `list.length === 0 ? ... : ...`。
 *
 * P3 收藏：`favoritedIds` 缺省不渲染收藏按钮（既有调用方零改动）；
 * 传入后逐卡透传 `favorited` / `isLoggedIn`（无回调，避免 server→client 函数 prop）。
 */

import { EmptyState } from '@/components/ui';
import type { ProjectDTO } from '@/lib/types';

import { ProjectCard } from './ProjectCard';

/** 组件属性。 */
export interface ProjectGridProps {
  projects: ProjectDTO[];
  /** P3 收藏：已收藏的作品 id 集合；缺省不渲染收藏按钮。 */
  favoritedIds?: Set<string> | null;
  /** P3 收藏：当前用户是否已登录（false 时点击跳登录）。 */
  isLoggedIn?: boolean;
  /**
   * P1 流式：显式开启收藏按钮渲染（即使未传 favoritedIds）。
   * 登录用户由客户端挂载后批量解析星标（壳先出、星标后补）；
   * 匿名访客渲染空星（点击跳登录），与 P3 原始行为一致。
   */
  showFavorites?: boolean;
  /** 空态标题。 */
  emptyTitle?: string;
  /** 空态描述。 */
  emptyDescription?: string;
  /** 空态操作区。 */
  emptyAction?: React.ReactNode;
}

/** 渲染作品网格或空态。 */
export function ProjectGrid({
  projects,
  favoritedIds,
  isLoggedIn = false,
  showFavorites = false,
  emptyTitle = '还没有作品',
  emptyDescription = '成为第一个在这里种下种子的人。',
  emptyAction,
}: ProjectGridProps) {
  if (projects.length === 0) {
    return <EmptyState title={emptyTitle} desc={emptyDescription} action={emptyAction} />;
  }

  return (
    <div className="grid">
      {projects.map((project) => (
        <ProjectCard
          key={project.slug}
          project={project}
          favorited={favoritedIds ? favoritedIds.has(project.id) : undefined}
          isLoggedIn={isLoggedIn}
          showFavorites={showFavorites}
          favoriteLoginNext={`/w/${project.slug}`}
        />
      ))}
    </div>
  );
}
