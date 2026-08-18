'use client';

/**
 * 移动端吸底投票条（P3 体验打磨）。
 *
 * ≤768px 显示在视口底部：`position: sticky; bottom: 0` 置于页面内容末尾，
 * 随内容滚动到页尾前自动释放，因此不会遮挡主站 footer 视觉。
 *
 * 复用与 VoteHero / CampaignVoteButton 相同的投票契约：
 *   - 未登录点击 → 跳 `/login?next={loginNext}`；
 *   - 未投 → POST /api/votes { projectId, campaignId? }（活动模式带 campaignId）；
 *   - 已投 → 再点取消（DELETE /api/votes/:projectId），按钮文案显示「已投」。
 *
 * 桌面端 `display: none`，由详情页 / 活动详情页在服务端渲染本组件。
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useToast } from '@/components/ui';
import { getDeviceFingerprint, getDwellMs } from '@/lib/fingerprint';
import type { ApiEnvelope } from '@/lib/types';
import { emitVoteSync, useVoteSync } from '@/lib/vote-sync';

/** 组件属性。 */
export interface MobileVoteBarProps {
  /** 作品的 DB id（cuid）—— 投票 API 的 projectId 契约用。 */
  projectId: string;
  /** 当前有效票数（详情页为全站票；活动页传活动票）。 */
  voteCount: number;
  /** 当前用户是否已投。 */
  hasVoted: boolean;
  /** 是否已登录。 */
  isLoggedIn: boolean;
  /** 未登录跳登录的回跳地址（如 `/w/{slug}` 或 `/campaigns/{slug}`）。 */
  loginNext: string;
  /** 活动模式：传入 campaignId 后按活动投票契约提交（含配额/自投限制）。 */
  campaignId?: string;
  /** 活动模式：剩余票数（≤0 且未投时禁用）。 */
  remainingQuota?: number;
  /** 活动模式：是否禁止自投（allowSelfVote=false 且是本人作品）。 */
  selfVoteForbidden?: boolean;
}

/** 投票接口返回。 */
interface VoteResponse {
  voted: boolean;
  voteCount: number;
  campaignVoteCount?: number;
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

/** 渲染吸底投票条。 */
export function MobileVoteBar({
  projectId,
  voteCount,
  hasVoted,
  isLoggedIn,
  loginNext,
  campaignId,
  remainingQuota,
  selfVoteForbidden,
}: MobileVoteBarProps): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();

  const [count, setCount] = useState<number>(voteCount);
  const [voted, setVoted] = useState<boolean>(hasVoted);
  const [busy, setBusy] = useState<boolean>(false);
  /** 投票成功次数，作为数字元素的 key：变化时重挂载触发跳动动画。 */
  const [pulseTick, setPulseTick] = useState<number>(0);

  // 与同页的 VoteHero / CampaignVoteButton 保持票数一致（同一 projectId）
  useVoteSync(projectId, (payload) => {
    setCount(payload.voteCount);
    setVoted(payload.voted);
  });

  /** 未登录跳登录，并保留返回地址。 */
  const redirectToLogin = (): void => {
    router.push(`/login?next=${encodeURIComponent(loginNext)}`);
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
        const body: Record<string, unknown> = { projectId, deviceHash, dwellMs };
        if (campaignId) body.campaignId = campaignId;
        const response = await fetch('/api/votes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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
      // 同步服务端渲染数据（活动规则 / 其它作品已投态等）
      router.refresh();
    } catch (error) {
      toast((error as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  /** 前端禁用：忙碌 / 自投被禁 / 未投且剩余票数为 0（活动模式）。 */
  const disabled =
    busy || selfVoteForbidden === true || (!voted && campaignId !== undefined && (remainingQuota ?? 0) <= 0);

  const title = selfVoteForbidden
    ? '本活动不支持给自己投票'
    : !isLoggedIn
      ? '登录后即可投票'
      : voted
        ? '点击取消投票'
        : campaignId !== undefined && (remainingQuota ?? 0) <= 0
          ? '已达本活动每人投票上限'
          : '投一票';

  return (
    <div className="mobile-vote-bar" aria-label="投票">
      <div className="mobile-vote-bar__info">
        <span key={pulseTick} className="mobile-vote-bar__count" data-animate={pulseTick > 0 ? 'true' : undefined}>
          {count}
        </span>
        <span className="mobile-vote-bar__hint">{campaignId !== undefined ? '活动票' : '当前票数'}</span>
      </div>

      <button
        type="button"
        className="btn btn-primary"
        data-voted={voted}
        disabled={disabled}
        onClick={() => void handleVote()}
        title={title}
      >
        <svg className="heart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
          <path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.5 12 20 12 20Z" />
        </svg>
        <span>{voted ? '已投' : '投一票'}</span>
      </button>
    </div>
  );
}
