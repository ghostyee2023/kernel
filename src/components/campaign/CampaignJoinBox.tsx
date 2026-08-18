'use client';

/**
 * 活动报名框（P1 活动模块）。
 *
 * 数据流：SSR 注入「我可报名的作品」（本人 ACTIVE、PUBLIC/UNLISTED、未报名），
 * 选作品 → POST /api/campaigns/:slug/join → toast + router.refresh()。
 *
 * 分支：
 *   - 不在报名期 → 只展示提示；
 *   - 未登录 → 「登录后报名」按钮（回跳本页）；
 *   - 无可报名作品 → 提示；
 *   - 正常 → 下拉 + 报名按钮（服务端仍二次校验：本人作品 / collecting 时间窗 / 幂等）。
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Select, useToast } from '@/components/ui';
import type { ApiEnvelope, ProjectCardLite } from '@/lib/types';

/** 组件属性。 */
export interface CampaignJoinBoxProps {
  campaignSlug: string;
  /** 是否处于可报名状态（effective collecting 且未到 collectEndAt）。 */
  canJoin: boolean;
  /** 已登录。 */
  isLoggedIn: boolean;
  /** 我可报名的作品（SSR 注入）。 */
  myProjects: ProjectCardLite[];
  /** 当前 joined 作品数。 */
  joinedCount: number;
}

/** 报名接口返回。 */
interface JoinResponse {
  joined: boolean;
  alreadyJoined: boolean;
  projectCount: number;
}

/** 渲染活动报名框。 */
export function CampaignJoinBox({
  campaignSlug,
  canJoin,
  isLoggedIn,
  myProjects,
  joinedCount,
}: CampaignJoinBoxProps): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();
  const [projectId, setProjectId] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  if (!canJoin) {
    return <p className="camp-join__hint">当前不在报名期，报名已截止，可前往活动榜查看结果。</p>;
  }

  if (!isLoggedIn) {
    return (
      <div className="camp-join">
        <p className="camp-join__hint">报名需要登录，登录后可选择你的作品参加本次活动。</p>
        <Button
          variant="primary"
          onClick={() => router.push(`/login?next=${encodeURIComponent(`/campaigns/${campaignSlug}`)}`)}
        >
          登录后报名
        </Button>
      </div>
    );
  }

  if (myProjects.length === 0) {
    return (
      <p className="camp-join__hint">
        暂无可报名的作品：需为你本人的公开作品（PUBLIC / UNLISTED）且尚未报名本活动。
      </p>
    );
  }

  /** 提交报名。 */
  const submit = async (): Promise<void> => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignSlug)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const body = (await response.json()) as ApiEnvelope<JoinResponse>;
      if (!body.ok) {
        toast(body.error.message, 'danger');
        return;
      }
      toast(body.data.alreadyJoined ? '该作品已在活动中' : '报名成功', 'success');
      setProjectId('');
      router.refresh();
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="camp-join">
      <div className="camp-join__row">
        <Select
          aria-label="选择要报名的作品"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="" disabled>
            选择我的作品…
          </option>
          {myProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </Select>
        <Button variant="primary" disabled={!projectId || busy} onClick={() => void submit()}>
          {busy ? '报名中…' : '报名参加'}
        </Button>
      </div>
      <p className="camp-join__count">
        已报名 <b className="mono">{joinedCount}</b> 件作品
      </p>
    </div>
  );
}
