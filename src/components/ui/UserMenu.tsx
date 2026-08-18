'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Avatar } from './Badge';

/** 会话用户（由服务端 layout 注入，仅取展示所需字段）。 */
export interface SessionUser {
  nickname: string;
  role: string;
}

/** 组件属性。 */
export interface UserMenuProps {
  /** 已登录用户。 */
  user: SessionUser;
}

/** 桌面端右上角用户菜单：用户按钮（头像缩写 + 昵称 + chevron）+ 绝对定位下拉。 */
export function UserMenu({ user }: UserMenuProps): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = React.useState<boolean>(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  // ⚠️ 内联角色判断，禁止 import lib/auth.ts（node:crypto 会进客户端 bundle）。
  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

  // 点击菜单外部区域关闭。
  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Escape 关闭并把焦点归还触发按钮。
  React.useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const close = React.useCallback((): void => setOpen(false), []);

  /** 退出登录：清会话后刷新，让服务端重新渲染登录态（与旧 Nav 行为一致）。 */
  const handleLogout = async (): Promise<void> => {
    close();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 即使请求失败也刷新，避免界面卡在错误态
    }
    router.refresh();
  };

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="user-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'user-menu' : undefined}
        aria-label={`用户菜单：${user.nickname}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Avatar name={user.nickname} />
        <span className="user-menu__name" title={user.nickname}>
          {user.nickname}
        </span>
        <svg
          className={cn('user-menu__chevron', open && 'user-menu__chevron--open')}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div id="user-menu" className="user-menu__menu" role="menu" aria-label="用户菜单">
          <Link className="user-menu__item" role="menuitem" href="/dashboard" onClick={close}>
            <span className="user-menu__item-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h4A2.5 2.5 0 0 1 13 6.5v11A2.5 2.5 0 0 1 10.5 20h-4A2.5 2.5 0 0 1 4 17.5v-11Z" />
                <path d="M15 8h3.5A1.5 1.5 0 0 1 20 9.5v6a1.5 1.5 0 0 1-1.5 1.5H15" />
                <path d="M15 4h1.5A2.5 2.5 0 0 1 19 6.5v1" />
              </svg>
            </span>
            我的作品
          </Link>

          {isAdmin ? (
            <Link className="user-menu__item" role="menuitem" href="/admin" onClick={close}>
              <span className="user-menu__item-icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 3 4.5 6v5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6L12 3Z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </span>
              后台管理
            </Link>
          ) : null}

          <div className="user-menu__divider" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="user-menu__item user-menu__item--danger"
            onClick={() => void handleLogout()}
          >
            <span className="user-menu__item-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </span>
            退出登录
          </button>
        </div>
      ) : null}
    </div>
  );
}
