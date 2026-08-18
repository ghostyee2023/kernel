'use client';

/**
 * 危险操作二次确认对话框（P2 后台）。
 *
 * 基于既有 `Modal`：danger 按钮 + 必填原因文案。PURGE / BLOCK / 封禁 / 作废票等
 * 危险操作必须经本组件确认后才发起请求。
 *
 * P2 风控 additive 扩展：可选 `reason` / `onReasonChange` props —— 传入时渲染
 * 原因输入框（风控作废等场景）；**现有调用方零改动**（不传即不渲染）。
 */

import * as React from 'react';

import { Button, Field, Modal, Textarea } from '@/components/ui';
import { RISK_REASON_MAX_LEN } from '@/lib/constants';

export interface ConfirmDialogProps {
  /** 是否打开。 */
  open: boolean;
  /** 对话框标题。 */
  title: string;
  /** 说明文案（可含受影响的记录信息）。 */
  description: React.ReactNode;
  /** 确认按钮文案，默认「确认」。 */
  confirmText?: string;
  /** 是否为危险操作（danger 按钮），默认 false。 */
  danger?: boolean;
  /** 请求进行中（禁用按钮，防止重复提交）。 */
  busy?: boolean;
  /** 可选：原因输入值（additive，仅当 onReasonChange 提供时渲染输入框）。 */
  reason?: string;
  /** 可选：原因输入回调（additive）。 */
  onReasonChange?: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 危险操作二次确认。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  danger = false,
  busy = false,
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): React.JSX.Element | null {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? '处理中…' : confirmText}
          </Button>
        </>
      }
    >
      {onReasonChange ? (
        <Field label="作废原因" htmlFor="confirm-reason" required hint={`必填，将写入审计日志（≤${RISK_REASON_MAX_LEN} 字）`}>
          <Textarea
            id="confirm-reason"
            rows={3}
            maxLength={RISK_REASON_MAX_LEN}
            value={reason ?? ''}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="如：同 IP 多账号刷票"
          />
        </Field>
      ) : null}
    </Modal>
  );
}
