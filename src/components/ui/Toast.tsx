'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

/** Toast 语气。 */
export type ToastTone = 'default' | 'success' | 'danger';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  /** 弹出一条 toast，默认 2600ms 后自动消失。 */
  toast: (message: string, tone?: ToastTone, durationMs?: number) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const TONE_CLASS: Record<ToastTone, string> = {
  default: '',
  success: 'toast--success',
  danger: 'toast--danger',
};

/**
 * Toast 容器。挂载在 RootLayout，供任意客户端组件通过 `useToast()` 调用。
 */
export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef<number>(1);

  const dismiss = React.useCallback((id: number): void => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = React.useCallback(
    (message: string, tone: ToastTone = 'default', durationMs = 2600): void => {
      const id = nextId.current++;
      setItems((prev) => [...prev, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={cn('toast', TONE_CLASS[item.tone])}>
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * 读取 toast 能力。必须在 `ToastProvider` 内部使用。
 *
 * @throws 当组件不在 ToastProvider 内时抛出错误。
 */
export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 <ToastProvider> 内部使用');
  return ctx;
}
