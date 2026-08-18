'use client';

/**
 * 活动投票按钮（P1 活动模块）。
 *
 * 交互：
 *   - 未登录点击 → 跳 `/login?next=/campaigns/{slug}`；
 *   - 未投 → POST /api/votes { projectId, campaignId }（服务端校验活动期/报名/自投/限票）；
 *   - 已投 → DELETE /api/votes/:projectId 取消（活动内票数是 COUNT 聚合，自然回落）。
 *
 * 前端禁用态：自投被禁、剩余票数 ≤ 0（服务端仍二次校验，双保险）。
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useToast } from '@/components/ui';
import { getDeviceFingerprint, getDwellMs } from '@/lib/fingerprint';
import type { ApiEnvelope } from '@/lib/types';
import { emitVoteSync, useVoteSync } from '@/lib/vote-sync';

/** 组件属性。 */
export interface CampaignVoteButtonProps {
  campaignSlug: string;
  campaignId: string;
  projectId: string;
  /** 该作品在本活动的票数。 */
  campaignVoteCount: number;
  /** 当前用户是否已投该作品（活动票与全站赞互斥，一人一作品一票）。 */
  hasVoted: boolean;
  isLoggedIn: boolean;
  /** 该用户在本活动的剩余票数。 */
  remainingQuota: number;
  /** 是否禁止自投（allowSelfVote=false 且是本人作品）。 */
  selfVoteForbidden: boolean;
}

/** 投票接口返回。 */
interface VoteResponse {
  voted: boolean;
  voteCount: number;
  campaignVoteCount?: number;
  remainingQuota?: number;
}

/** 统一信封解析，失败时抛出带 code 的错误。 */
class VoteApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'VoteApiError';
    this.code = code;
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  let body: ApiEnvelope<T>;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new VoteApiError('INTERNAL_ERROR', `服务返回异常（HTTP ${response.status}）`);
  }
  if (!body.ok) throw new VoteApiError(body.error.code, body.error.message);
  return body.data;
}

/** 渲染活动投票按钮。 */
export function CampaignVoteButton({
  campaignSlug,
  campaignId,
  projectId,
  campaignVoteCount,
  hasVoted,
  isLoggedIn,
  remainingQuota,
  selfVoteForbidden,
}: CampaignVoteButtonProps): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();

  const [count, setCount] = useState<number>(campaignVoteCount);
  const [voted, setVoted] = useState<boolean>(hasVoted);
  const [busy, setBusy] = useState<boolean>(false);
  /** 投票成功次数，作为数字元素的 key：变化时重挂载触发跳动动画。 */
  const [pulseTick, setPulseTick] = useState<number>(0);

  // 与同页 MobileVoteBar 保持票数一致（同一 projectId）
  useVoteSync(projectId, (payload) => {
    setCount(payload.voteCount);
    setVoted(payload.voted);
  });

  const redirectToLogin = (): void => {
    router.push(`/login?next=${encodeURIComponent(`/campaigns/${campaignSlug}`)}`);
  };

  /** 投票 / 取消投票主流程。 */
  const toggle = async (): Promise<void> => {
    if (!isLoggedIn) {
      redirectToLogin();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      if (voted) {
        const response = await fetch(`/api/votes/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
        if (response.status === 401) {
          toast('登录已过期，请重新登录', 'danger');
          redirectToLogin();
          return;
        }
        const data = await unwrap<VoteResponse>(response);
        const nextCount = data.campaignVoteCount !== undefined ? data.campaignVoteCount : data.voteCount;
        setVoted(data.voted);
        setCount(nextCount);
        setPulseTick((tick) => tick + 1);
        emitVoteSync({ projectId, voteCount: nextCount, voted: data.voted });
        toast('已取消投票', 'default');
      } else {
        // 投票（P2 风控：上报 deviceHash/dwellMs；指纹失败不阻塞投票）
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
          body: JSON.stringify({ projectId, campaignId, deviceHash, dwellMs }),
        });
        if (response.status === 401) {
          toast('登录已过期，请重新登录', 'danger');
          redirectToLogin();
          return;
        }
        const data = await unwrap<VoteResponse>(response);
        const nextCount = data.campaignVoteCount !== undefined ? data.campaignVoteCount : data.voteCount;
        setVoted(data.voted);
        setCount(nextCount);
        setPulseTick((tick) => tick + 1);
        emitVoteSync({ projectId, voteCount: nextCount, voted: data.voted });
        toast('投票成功', 'success');
      }
      // 同步服务端（剩余票数 / 其它作品的已投态）
      router.refresh();
    } catch (error) {
      toast((error as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  /** 前端禁用：忙碌 / 自投被禁 / 未投且剩余票数为 0。 */
  const disabled = busy || selfVoteForbidden || (!voted && remainingQuota <= 0);

  const title = selfVoteForbidden
    ? '本活动不支持给自己投票'
    : !isLoggedIn
      ? '登录后即可投票'
      : voted
        ? '点击取消投票'
        : remainingQuota <= 0
          ? '已达本活动每人投票上限'
          : '投一票';

  return (
    <button
      type="button"
      className="btn-vote"
      data-voted={voted}
      disabled={disabled}
      onClick={() => void toggle()}
      title={title}
    >
      <svg className="heart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
        <path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.5 12 20 12 20Z" />
      </svg>
      <span key={pulseTick} className="num" data-animate={pulseTick > 0 ? 'true' : undefined}>
        {count}
      </span>
      <span>{voted ? '已投' : '投票'}</span>
    </button>
  );
}
