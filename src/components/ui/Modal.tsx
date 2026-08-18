'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';

export interface ModalProps {
  /** 是否打开。 */
  open: boolean;
  /** 关闭回调（点击遮罩、按 Esc、点右上角关闭）。 */
  onClose: () => void;
  /** 模态标题。 */
  title: string;
  /** 标题下的说明文案。 */
  description?: React.ReactNode;
  /** 底部操作区。 */
  footer?: React.ReactNode;
  /** 是否允许点击遮罩关闭，默认 true。 */
  dismissible?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * 轻量模态框。不依赖任何第三方无障碍库，自行处理：
 * Esc 关闭、body 滚动锁定、遮罩点击关闭、初始焦点。
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  dismissible = true,
  className,
  children,
}: ModalProps): React.JSX.Element | null {
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && dismissible) onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return (
    <div
      className="scrim"
      onClick={() => {
        if (dismissible) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn('modal', className)}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: description ? 8 : 18 }}>
          <h2 className="t-title" style={{ flex: 1 }}>
            {title}
          </h2>
          <IconButton label="关闭" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </IconButton>
        </div>
        {description ? (
          <p className="t-body-sm muted" style={{ marginBottom: 18 }}>
            {description}
          </p>
        ) : null}
        {children}
        {footer ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
