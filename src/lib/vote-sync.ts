'use client';

/**
 * 同页多投票组件（VoteHero / CampaignVoteButton / MobileVoteBar）的轻量同步。
 *
 * 详情页同时渲染 VoteHero 与 MobileVoteBar（由视口宽度决定显示哪一个），
 * 活动页同理。各组件各自持有 useState，若不做同步，用户在一个组件投票后，
 * 另一个组件的票数会过期。这里用 CustomEvent 广播最新票数，零依赖、零全局 store。
 */

import { useEffect } from 'react';

/** 广播载荷：按 projectId 匹配，避免误更新其它作品。 */
export interface VoteSyncPayload {
  projectId: string;
  /** 展示用票数（详情页为全站票，活动页为活动票）。 */
  voteCount: number;
  voted: boolean;
}

/** 事件名。 */
const VOTE_SYNC_EVENT = 'kernel:vote-sync';

/** 广播一次票数变化（仅客户端生效）。 */
export function emitVoteSync(payload: VoteSyncPayload): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<VoteSyncPayload>(VOTE_SYNC_EVENT, { detail: payload }));
}

/**
 * 订阅票数变化；仅当载荷 projectId 与自身一致时回调。
 *
 * @param projectId 自身作品 id（过滤用）。
 * @param onSync 收到匹配广播后的回调。
 */
export function useVoteSync(projectId: string, onSync: (payload: VoteSyncPayload) => void): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const listener = (event: Event): void => {
      const payload = (event as CustomEvent<VoteSyncPayload>).detail;
      if (payload && payload.projectId === projectId) onSync(payload);
    };
    window.addEventListener(VOTE_SYNC_EVENT, listener);
    return () => window.removeEventListener(VOTE_SYNC_EVENT, listener);
  }, [projectId, onSync]);
}
