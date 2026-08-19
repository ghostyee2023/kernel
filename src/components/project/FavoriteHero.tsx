'use client';

/**
 * FavoriteHero —— 详情页收藏操作卡（视觉与 VoteHero 对称）。
 *
 * 左侧：当前收藏数（乐观更新）；右侧：星形按钮（点击切换收藏/取消收藏）。
 *
 * 未登录：点按钮跳登录页（next 回详情页）；
 * 会话过期（401）：跳登录；
 * 与同屏 MobileVoteBar 不冲突（FavoriteHero 仅桌面端可见）。
 */

import * as React from 'react';

import { useRouter } from 'next/navigation';

import { cn } from '@/lib/cn';

/** 响应体（与后端 /api/projects/[slug]/favorite 对齐）。 */
interface FavoriteToggleResult {
  favorited: boolean;
}

/** 组件属性。 */
export interface FavoriteHeroProps {
  /** 作品 slug（API 路径用）。 */
  slug: string;
  /** 作品 id（保留：与同屏组件对齐未来扩展）。 */
  projectId: string;
  /** SSR 注入的当前收藏数。 */
  favoriteCount: number;
  /** 当前用户是否已收藏。 */
  favorited: boolean;
  /** 是否已登录（false 时点按钮跳登录）。 */
  isLoggedIn: boolean;
}

/** 渲染收藏区（与 VoteHero 视觉对称）。 */
export function FavoriteHero({ slug, favoriteCount, favorited, isLoggedIn }: FavoriteHeroProps): React.JSX.Element {
  const router = useRouter();
  const [count, setCount] = React.useState<number>(favoriteCount);
  const [active, setActive] = React.useState<boolean>(favorited);
  const [busy, setBusy] = React.useState<boolean>(false);
  const [pulseTick, setPulseTick] = React.useState<number>(0);

  /** 未登录 / 401 → 跳登录（next 回详情）。 */
  const redirectToLogin = (): void => {
    router.push(`/login?next=${encodeURIComponent(`/w/${slug}`)}`);
  };

  /** 切换收藏（乐观更新：toggle 成功本地 +1/-1）。 */
  const handleToggle = async (): Promise<void> => {
    if (!isLoggedIn) {
      redirectToLogin();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/favorite`, { method: 'POST' });
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      const body = (await response.json()) as { ok?: boolean; data?: FavoriteToggleResult };
      if (!body.ok || !body.data) {
        return;
      }
      const nextActive = body.data.favorited;
      // 乐观更新收藏数
      setActive(nextActive);
      setCount((prev) => prev + (nextActive === active ? 0 : nextActive ? 1 : -1));
      setPulseTick((tick) => tick + 1);
    } catch {
      // 静默：失败时不动状态
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('vote-hero', 'fav-hero')} aria-label="收藏">
      <div>
        <div key={pulseTick} className="vote-hero__num" data-animate={pulseTick > 0 ? 'true' : undefined}>
          {count}
        </div>
        <div className="t-caption muted" style={{ marginTop: 3 }}>
          {count} 人收藏
        </div>
      </div>

      <div className="nav__spacer" aria-hidden="true" />

      <button
        type="button"
        className="btn-vote btn-vote-lg"
        data-voted={active}
        onClick={() => void handleToggle()}
        disabled={busy}
        title={isLoggedIn ? (active ? '点击取消收藏' : '收藏这件作品') : '登录后即可收藏'}
      >
        <svg className="star" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
          <path d="m12 2 3 7 7 .6-5.3 4.7L18 22l-6-3.7L6 22l1.3-7.7L2 9.6 9 9z" />
        </svg>
        <span className="txt">{active ? '已收藏' : '收藏'}</span>
      </button>
    </div>
  );
}