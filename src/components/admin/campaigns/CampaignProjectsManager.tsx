'use client';

/**
 * 活动报名作品管理（P1 活动模块）—— 编辑页内嵌。
 *
 * 已报名作品列表 + 行内「移除」按钮（ConfirmDialog 二次确认 → DELETE
 * /api/admin/campaigns/:id/projects/:projectId），成功后 toast + refresh。
 * 只阻止新投票；存量票保留、仍计入活动累计（§八 Q8）。
 */

import * as React from 'react';

import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { CoverPlaceholder } from '@/components/project';
import { Button, Table, TBody, Td, Th, THead, Tr, useToast } from '@/components/ui';
import { formatCount } from '@/lib/format';
import type { ApiEnvelope, CampaignProjectItem } from '@/lib/types';

/** 组件入参（SSR 注入）。 */
export interface CampaignProjectsManagerProps {
  campaignId: string;
  initialProjects: CampaignProjectItem[];
}

/** 待移除确认项。 */
interface PendingRemove {
  projectId: string;
  title: string;
}

/** 渲染报名作品管理。 */
export function CampaignProjectsManager({
  campaignId,
  initialProjects,
}: CampaignProjectsManagerProps): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<PendingRemove | null>(null);
  const [busy, setBusy] = React.useState<boolean>(false);

  /** 移除报名。 */
  const remove = async (): Promise<void> => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/admin/campaigns/${encodeURIComponent(campaignId)}/projects/${encodeURIComponent(pending.projectId)}`,
        { method: 'DELETE' },
      );
      const body = (await response.json()) as ApiEnvelope<{ removed: boolean }>;
      if (!body.ok) {
        toast(body.error.message, 'danger');
        return;
      }
      toast('已移除该作品的报名', 'success');
      router.refresh();
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  if (initialProjects.length === 0) {
    return <p className="muted">还没有作品报名本活动。</p>;
  }

  return (
    <div className="admin-table-wrap">
      <div className="admin-table-scroll">
        <Table>
          <THead>
            <Tr>
              <Th>作品</Th>
              <Th>作者</Th>
              <Th className="admin-table__num">活动票</Th>
              <Th className="admin-table__num">全站票</Th>
              <Th className="admin-table__actions">操作</Th>
            </Tr>
          </THead>
          <TBody>
            {initialProjects.map((item) => (
              <Tr key={item.project.id}>
                <Td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <CoverPlaceholder
                      slug={item.project.slug}
                      title={item.project.title}
                      coverUrl={item.project.coverUrl}
                      className="camp-proj__thumb"
                    />
                    <div style={{ minWidth: 0 }}>
                      <div className="admin-table__title" title={item.project.title}>
                        {item.project.title}
                      </div>
                      <div className="mono admin-table__slug">{item.project.slug}</div>
                    </div>
                  </div>
                </Td>
                <Td>
                  <span className="t-body-sm">{item.project.authorName}</span>
                </Td>
                <Td className="admin-table__num">
                  <span className="mono">{formatCount(item.campaignVoteCount)}</span>
                </Td>
                <Td className="admin-table__num">
                  <span className="mono">{formatCount(item.project.voteCount)}</span>
                </Td>
                <Td className="admin-table__actions">
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      setPending({ projectId: item.project.id, title: item.project.title })
                    }
                  >
                    移除
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>

      {pending ? (
        <ConfirmDialog
          open
          title="移除报名作品"
          description={`将把「${pending.title}」移出本活动：该作品不再显示在活动页、也无法再投活动票；已投的票保留并仍计入活动累计。`}
          danger
          confirmText="确认移除"
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void remove()}
        />
      ) : null}
    </div>
  );
}
