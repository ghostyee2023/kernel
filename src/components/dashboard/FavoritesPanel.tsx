'use client';

/**
 * 收藏（个人空间 Tab 3）—— client 组件。
 *
 * SSR initialProjects + initialFavoritedIds → ProjectGrid（卡片复用 + 右上角收藏按钮可取消）。
 * 取消收藏：监听全局 `favorite:changed` 事件做本地即时移除（不回退整页）+ router.refresh() 同步计数卡；
 * 列表空时 ProjectGrid 自动切空态（Q2 文案）。
 *
 * 注意：之前通过 ProjectCard→FavoriteButton 透传 `onToggle` 回调，会让 SSR 路径（广场等）跨
 * server→client 函数 prop 边界导致序列化失败。现改用 window CustomEvent 通信，所有调用方无差别受益。
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { ProjectGrid } from '@/components/project';
import { FAVORITE_CHANGED_EVENT, type FavoriteChangedDetail } from '@/components/project/FavoriteButton';
import type { ProjectDTO } from '@/lib/types';

/** 组件属性。 */
export interface FavoritesPanelProps {
  /** SSR 已过滤 PURGED/BLOCKED/PRIVATE 的收藏作品（ARCHIVED 保留）。 */
  initialProjects: ProjectDTO[];
  /** 我收藏的作品 id 列表（SSR 一次取齐，供卡片已收藏态）。 */
  initialFavoritedIds: string[];
}

/** 渲染收藏网格。 */
export function FavoritesPanel({ initialProjects, initialFavoritedIds }: FavoritesPanelProps): React.JSX.Element {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectDTO[]>(initialProjects);
  const favoritedIds = useMemo(() => new Set(initialFavoritedIds), [initialFavoritedIds]);

  /** 订阅全局 favorite:changed 事件：取消时本地移除卡片。 */
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<FavoriteChangedDetail>).detail;
      if (!detail || detail.favorited !== false) return;
      const target = projects.find((project) => project.slug === detail.slug);
      if (!target) return;
      setProjects((prev) => prev.filter((project) => project.id !== target.id));
      router.refresh();
    };
    window.addEventListener(FAVORITE_CHANGED_EVENT, handler);
    return () => {
      window.removeEventListener(FAVORITE_CHANGED_EVENT, handler);
    };
    // projects 闭包用当前值；handler 每次渲染重绑即可（订阅频率低、可接受）
  }, [projects, router]);

  return (
    <ProjectGrid
      projects={projects}
      favoritedIds={favoritedIds}
      isLoggedIn
      emptyTitle="还没有收藏"
      emptyDescription="看到喜欢的作品就点亮星标，收藏后会统一出现在这里。"
      emptyAction={
        <Link className="btn btn-primary" href="/">
          逛逛广场
        </Link>
      }
    />
  );
}
