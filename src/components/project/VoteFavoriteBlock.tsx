'use client';

/**
 * VoteFavoriteBlock —— 详情页「投票 + 收藏」单卡（对齐 prototype/work-detail-redesign.html）。
 *
 * 把原 VoteHero 与 FavoriteHero 的两张对称卡合并为一张：
 *   上方：票数头部（当前得票 + 大字号 mono 数字）
 *   下方一行：[品红投票按钮] + [收藏 pill]
 *
 * 后端契约完全复用，不新增任何 API / 路由：
 *   - 投票：POST /api/votes（投票） / DELETE /api/votes/[projectId]（取消），参考 VoteHero；
 *   - 收藏：POST /api/projects/[slug]/favorite（toggle），参考 FavoriteHero / FavoriteButton。
 *
 * 跨组件同步：
 *   - 投票：emitVoteSync / useVoteSync（与同页 MobileVoteBar 保持票数一致）；
 *   - 收藏：toggle 成功后 invalidateFavoriteCache + 派发 FAVORITE_CHANGED_EVENT，并 router.refresh()
 *     让服务端重渲染（与同页移动端吸底条保持一致）。
 */

import { useRouter } from 'next/navigation';
import * as React from 'react';

import { useToast } from '@/components/ui';
import { FAVORITE_CHANGED_EVENT, type FavoriteChangedDetail } from '@/components/project/FavoriteButton';
import { cn } from '@/lib/cn';
import { getDeviceFingerprint, getDwellMs } from '@/lib/fingerprint';
import type { ApiEnvelope } from '@/lib/types';
import { invalidateFavoriteCache } from '@/lib/favorite-client';
import { emitVoteSync, useVoteSync } from '@/lib/vote-sync';

/** 组件属性。 */
export interface VoteFavoriteBlockProps {
  /** 作品 slug（收藏 API 路径用）。 */
  slug: string;
  /** 作品的 DB id（cuid）—— 投票 API 的 projectId 契约用。 */
  projectId: string;
  /** 当前有效票数。 */
  voteCount: number;
  /** 当前用户是否已投。 */
  hasVoted: boolean;
  /** 当前收藏数。 */
  favoriteCount: number;
  /** 当前用户是否已收藏。 */
  hasFavorited: boolean;
  /** 是否已登录（由服务端传入；false 时点击跳登录）。 */
  isLoggedIn: boolean;
}

/** 投票接口返回。 */
interface VoteResponse {
  voted: boolean;
  voteCount: number;
}

/** 收藏接口返回。 */
interface FavoriteResponse {
  favorited: boolean;
}

/** 统一信封解析，失败时抛出中文错误。 */
async function unwrap<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!body.ok) throw new Error(body.error.message);
  return body.data;
}

/** 收藏图标（心形，与投票爱心区分）。`className` 可叠加动画类（如 is-pop）。 */
function HeartIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={cn('fav-heart', className)}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-7.5-4.6-10-9.2C.3 8.4 1.9 4.9 5.2 4.3c2-.4 3.8.6 4.8 2.1.4.6.7 1.1.7 1.1s.3-.5.7-1.1c1-1.5 2.8-2.5 4.8-2.1 3.3.6 4.9 4.1 3.2 7.5C19.5 16.4 12 21 12 21z" />
    </svg>
  );
}

/** 渲染投票 + 收藏单卡。 */
export function VoteFavoriteBlock({
  slug,
  projectId,
  voteCount,
  hasVoted,
  favoriteCount,
  hasFavorited,
  isLoggedIn,
}: VoteFavoriteBlockProps): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();

  // —— 投票状态 ——
  const [count, setCount] = React.useState<number>(voteCount);
  const [voted, setVoted] = React.useState<boolean>(hasVoted);
  const [voteBusy, setVoteBusy] = React.useState<boolean>(false);
  const [votePulse, setVotePulse] = React.useState<number>(0);

  // —— 收藏状态 ——
  const [favCount, setFavCount] = React.useState<number>(favoriteCount);
  const [favActive, setFavActive] = React.useState<boolean>(hasFavorited);
  const [favBusy, setFavBusy] = React.useState<boolean>(false);
  const [favPulse, setFavPulse] = React.useState<number>(0);

  // 与同页 MobileVoteBar 保持票数一致（同一 projectId）
  useVoteSync(projectId, (payload) => {
    setCount(payload.voteCount);
    setVoted(payload.voted);
  });

  const redirectToLogin = (next: string): void => {
    router.push(`/login?next=${encodeURIComponent(next)}`);
  };

  /** 投票 / 取消投票。 */
  const handleVote = async (): Promise<void> => {
    if (!isLoggedIn) {
      redirectToLogin(`/w/${slug}`);
      return;
    }
    if (voteBusy) return;
    setVoteBusy(true);
    try {
      if (voted) {
        const response = await fetch(`/api/votes/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
        if (response.status === 401) {
          toast('登录已过期，请重新登录', 'danger');
          redirectToLogin(`/w/${slug}`);
          return;
        }
        const data = await unwrap<VoteResponse>(response);
        setVoted(data.voted);
        setCount(data.voteCount);
        setVotePulse((tick) => tick + 1);
        emitVoteSync({ projectId, voteCount: data.voteCount, voted: data.voted });
        toast('已取消投票', 'default');
      } else {
        let deviceHash: string | undefined;
        let dwellMs: number | undefined;
        try {
          const fingerprint = await getDeviceFingerprint();
          deviceHash = fingerprint.deviceHash;
          dwellMs = getDwellMs();
        } catch {
          deviceHash = undefined;
          dwellMs = undefined;
        }
        const response = await fetch('/api/votes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, deviceHash, dwellMs }),
        });
        if (response.status === 401) {
          toast('登录已过期，请重新登录', 'danger');
          redirectToLogin(`/w/${slug}`);
          return;
        }
        const data = await unwrap<VoteResponse>(response);
        setVoted(data.voted);
        setCount(data.voteCount);
        setVotePulse((tick) => tick + 1);
        emitVoteSync({ projectId, voteCount: data.voteCount, voted: data.voted });
        toast('投票成功，感谢支持', 'success');
      }
    } catch (error) {
      toast((error as Error).message, 'danger');
    } finally {
      setVoteBusy(false);
    }
  };

  /** 收藏 / 取消收藏（乐观更新）。 */
  const handleFavorite = async (): Promise<void> => {
    if (!isLoggedIn) {
      redirectToLogin(`/w/${slug}`);
      return;
    }
    if (favBusy) return;
    setFavBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/favorite`, { method: 'POST' });
      if (response.status === 401) {
        toast('登录已过期，请重新登录', 'danger');
        redirectToLogin(`/w/${slug}`);
        return;
      }
      const data = await unwrap<FavoriteResponse>(response);
      const nextActive = data.favorited;
      setFavActive(nextActive);
      setFavCount((prev) => prev + (nextActive === favActive ? 0 : nextActive ? 1 : -1));
      setFavPulse((tick) => tick + 1);
      // 跨组件一致性：失效客户端收藏集合 + 通知监听方
      invalidateFavoriteCache();
      window.dispatchEvent(
        new CustomEvent<FavoriteChangedDetail>(FAVORITE_CHANGED_EVENT, { detail: { slug, favorited: nextActive } }),
      );
      toast(nextActive ? '已收藏' : '已取消收藏', nextActive ? 'success' : 'default');
      router.refresh();
    } catch (error) {
      toast((error as Error).message, 'danger');
    } finally {
      setFavBusy(false);
    }
  };

  return (
    <div className="vote-block" aria-label="投票与收藏">
      <div className="vote-head">
        <span className="vote-label">当前得票</span>
        <span key={votePulse} className={cn('vote-num', votePulse > 0 && 'is-pop')}>
          {count}
        </span>
      </div>

      <div className="vote-actions">
        <button
          type="button"
          className="vote-btn"
          data-voted={voted}
          aria-pressed={voted}
          onClick={() => void handleVote()}
          disabled={voteBusy}
          title={isLoggedIn ? (voted ? '点击取消投票' : '投一票') : '登录后即可投票'}
        >
          <span>{voted ? '已投票' : '投一票'}</span>
        </button>

        <button
          type="button"
          className="fav-pill"
          aria-pressed={favActive}
          onClick={() => void handleFavorite()}
          disabled={favBusy}
          title={isLoggedIn ? (favActive ? '点击取消收藏' : '收藏这件作品') : '登录后即可收藏'}
        >
          <HeartIcon key={favPulse} className={favPulse > 0 ? 'is-pop' : undefined} />
          <span className="fav-label">{favActive ? '已收藏' : '收藏'}</span>
          <span className="fav-num">{favCount}</span>
        </button>
      </div>
    </div>
  );
}
