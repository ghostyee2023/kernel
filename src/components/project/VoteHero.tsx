'use client';

/**
 * 详情页投票区（P1 第一阶段：真实票数 + 登录投票）。
 *
 * 交互：
 *   - 未登录点击 → 跳转 `/login?next=/w/{slug}`；
 *   - 已登录未投 → POST /api/votes（票数 +1、变已投）；
 *   - 已登录已投 → 再点取消（DELETE /api/votes/:projectId，票数 -1）。
 *
 * 视觉复用 globals.css 的 .vote-hero / .btn-vote / .btn-vote-lg
 * （voted 态的 .btn-vote[data-voted="true"] 样式在 P0 已就位）。
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useToast } from '@/components/ui';
import { getDeviceFingerprint, getDwellMs } from '@/lib/fingerprint';
import type { ApiEnvelope } from '@/lib/types';
import { emitVoteSync, useVoteSync } from '@/lib/vote-sync';

/** 组件属性。 */
export interface VoteHeroProps {
  slug: string;
  /** 作品的 DB id（cuid）—— 投票 API 的 projectId 契约用。 */
  projectId: string;
  /** 当前有效票数。 */
  voteCount: number;
  /** 当前用户是否已投。 */
  hasVoted: boolean;
  /** 是否已登录（由服务端 layout/详情页传入）。 */
  isLoggedIn: boolean;
}

/** 投票接口返回。 */
interface VoteResponse {
  voted: boolean;
  voteCount: number;
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

/** 渲染投票区。 */
export function VoteHero({ slug, projectId, voteCount, hasVoted, isLoggedIn }: VoteHeroProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [count, setCount] = useState<number>(voteCount);
  const [voted, setVoted] = useState<boolean>(hasVoted);
  const [busy, setBusy] = useState<boolean>(false);
  /** 投票成功次数，作为数字元素的 key：变化时重挂载触发跳动动画。 */
  const [pulseTick, setPulseTick] = useState<number>(0);

  // 与同页 MobileVoteBar 保持票数一致（同一 projectId）
  useVoteSync(projectId, (payload) => {
    setCount(payload.voteCount);
    setVoted(payload.voted);
  });

  /** 会话失效时跳登录，并保留返回地址。 */
  const redirectToLogin = (): void => {
    router.push(`/login?next=${encodeURIComponent(`/w/${slug}`)}`);
  };

  /** 投票 / 取消投票主流程。 */
  const handleVote = async (): Promise<void> => {
    if (!isLoggedIn) {
      redirectToLogin();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      if (voted) {
        // 取消投票
        const response = await fetch(`/api/votes/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
        if (response.status === 401) {
          toast('登录已过期，请重新登录', 'danger');
          redirectToLogin();
          return;
        }
        const data = await unwrap<VoteResponse>(response);
        setVoted(data.voted);
        setCount(data.voteCount);
        setPulseTick((tick) => tick + 1);
        emitVoteSync({ projectId, voteCount: data.voteCount, voted: data.voted });
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
          body: JSON.stringify({ projectId, deviceHash, dwellMs }),
        });
        if (response.status === 401) {
          toast('登录已过期，请重新登录', 'danger');
          redirectToLogin();
          return;
        }
        const data = await unwrap<VoteResponse>(response);
        setVoted(data.voted);
        setCount(data.voteCount);
        setPulseTick((tick) => tick + 1);
        emitVoteSync({ projectId, voteCount: data.voteCount, voted: data.voted });
        toast('投票成功，感谢支持', 'success');
      }
    } catch (error) {
      toast((error as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vote-hero" aria-label="投票">
      <div>
        <div key={pulseTick} className="vote-hero__num" data-animate={pulseTick > 0 ? 'true' : undefined}>
          {count}
        </div>
        <div className="t-caption muted" style={{ marginTop: 3 }}>
          当前票数 · 每人一票
        </div>
      </div>

      <div className="nav__spacer" aria-hidden="true" />

      <button
        type="button"
        className="btn-vote btn-vote-lg"
        data-voted={voted}
        onClick={() => void handleVote()}
        disabled={busy}
        title={isLoggedIn ? (voted ? '点击取消投票' : '投一票') : '登录后即可投票'}
      >
        <svg className="heart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
          <path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.5 12 20 12 20Z" />
        </svg>
        <span className="txt">{voted ? '取消投票' : '投一票'}</span>
      </button>
    </div>
  );
}
