'use client';

/**
 * 作品操作区：续期 / 下线。
 *
 * 鉴权：仅作者本人或管理员可操作。父级（状态页）计算 `canManage` 后传入；
 * 为 false 时整块不渲染（防止请求侧泄漏操作入口）。
 * 破坏性操作（下线）走二次确认弹窗，避免误点。
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Modal, Select, useToast } from '@/components/ui';
import { TTL_OPTIONS } from '@/lib/constants';
import type { ApiEnvelope } from '@/lib/types';

/** 组件属性。 */
export interface ProjectActionsProps {
  slug: string;
  /** 当前 TTL，作为续期下拉的默认值。 */
  ttlDays: number;
  /** 是否已归档（归档态下按钮文案改为「恢复」）。 */
  archived?: boolean;
  /**
   * 是否允许管理（作者本人或管理员）。false 时整块不渲染。
   * 缺省 true，兼容 P0 无登录期的调用方。
   */
  canManage?: boolean;
}

/** 解析统一响应信封，失败时抛出中文错误。 */
async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!body.ok) throw new Error(body.error.message);
  return body.data;
}

/** 渲染操作按钮组。 */
export function ProjectActions({ slug, ttlDays, archived = false, canManage = true }: ProjectActionsProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [renewDays, setRenewDays] = useState<number>(ttlDays);
  const [renewing, setRenewing] = useState<boolean>(false);
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  // 无管理权限时不渲染操作区（仅展示状态说明）
  if (!canManage) return null;

  /** 续期（归档态下同时复活）。 */
  const handleRenew = async (): Promise<void> => {
    setRenewing(true);
    try {
      const response = await fetch(`/api/projects/${slug}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttlDays: renewDays }),
      });
      await parse<{ expireAt: string }>(response);
      toast(archived ? '作品已恢复上线' : `已续期 ${renewDays} 天`, 'success');
      router.refresh();
    } catch (error) {
      toast((error as Error).message, 'danger');
    } finally {
      setRenewing(false);
    }
  };

  /** 下线到回收站。 */
  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/projects/${slug}`, { method: 'DELETE' });
      await parse<{ slug: string }>(response);
      toast('作品已下线，30 天内可恢复', 'success');
      setConfirmOpen(false);
      router.push(`/_status/${slug}`);
    } catch (error) {
      toast((error as Error).message, 'danger');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="actions">
        <div className="actions__renew">
          <Select
            aria-label="续期时长"
            value={String(renewDays)}
            onChange={(event) => setRenewDays(Number(event.target.value))}
          >
            {TTL_OPTIONS.map((days) => (
              <option key={days} value={days}>
                延长 {days} 天
              </option>
            ))}
          </Select>
          <Button onClick={() => void handleRenew()} disabled={renewing}>
            {renewing ? '处理中…' : archived ? '恢复上线' : '续期'}
          </Button>
        </div>

        {!archived ? (
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            下线作品
          </Button>
        ) : null}
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="确认下线这件作品？"
        description="下线后作品立即无法访问，但会在回收站保留 30 天，期间可随时恢复。超过 30 天将被永久删除。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? '处理中…' : '确认下线'}
            </Button>
          </>
        }
      />
    </>
  );
}
