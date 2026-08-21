'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './ThemeToggle';
import { Avatar } from './Badge';
import { UserMenu, type SessionUser } from './UserMenu';

// 为兼容 layout.tsx 的 `import { Nav, type SessionUser } from '@/components/ui/Nav'` 而 re-export。
export type { SessionUser } from './UserMenu';

interface NavItem {
  href: string;
  label: string;
  /** P0 未实现的入口以置灰形式展示。 */
  disabled?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: '作品广场' },
  { href: '/rank', label: '排行榜' },
  { href: '/campaigns', label: '活动' },
  // P3 个人空间：所有角色可见（非 ADMIN 专属；访客点击由 /dashboard 页面层 302 到登录）
  { href: '/dashboard', label: '我的作品' },
];

/** 组件属性。 */
export interface NavProps {
  /** 已登录用户；未登录为 null/undefined。 */
  sessionUser?: SessionUser | null;
}

/** 站点顶部导航（sticky + 毛玻璃 + 移动端抽屉）。 */
export function Nav({ sessionUser = null }: NavProps): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = React.useState<boolean>(false);

  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const isCurrent = (href: string): boolean => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  /** 退出登录：清会话后刷新，让服务端重新渲染登录态。 */
  const handleLogout = async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 即使请求失败也刷新，避免界面卡在错误态
    }
    router.refresh();
  };

  // 后台管理入口：仅 ADMIN / SUPER_ADMIN 可见（P2）。
  // ⚠️ 内联角色判断，禁止 import lib/auth.ts（node:crypto 会进客户端 bundle）。
  const isAdmin = sessionUser?.role === 'ADMIN' || sessionUser?.role === 'SUPER_ADMIN';
  const navItems: readonly NavItem[] = isAdmin
    ? [...NAV_ITEMS, { href: '/admin', label: '后台管理' }]
    : NAV_ITEMS;

  return (
    <>
      <header className="nav">
        <div className="nav__inner">
          <Link className="logo" href="/">
            <span className="logo__mark" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  fillOpacity=".95"
                  fillRule="evenodd"
                  d="M12 3.2c4.2 2.7 6.5 5.9 6.5 9.3a6.5 6.5 0 1 1-13 0c0-3.4 2.3-6.6 6.5-9.3Zm0 6.6a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z"
                />
              </svg>
            </span>
            <span className="logo__text">
              Kernel<span className="logo__cn">创意种子</span>
            </span>
          </Link>

          <nav className="nav__links" aria-label="主导航">
            {navItems.map((item) =>
              item.disabled ? (
                <span
                  key={item.href}
                  className="nav__link"
                  aria-disabled="true"
                  title="P0 阶段暂未开放"
                  style={{ opacity: 0.42, cursor: 'not-allowed' }}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  key={item.href}
                  className="nav__link"
                  href={item.href}
                  aria-current={isCurrent(item.href) ? 'page' : undefined}
                >
                  {item.href === '/' ? <i className="ri-gallery-line" aria-hidden="true" /> : null}
                  {item.label}
                </Link>
              ),
            )}
          </nav>

          <div className="nav__spacer" />

          <ThemeToggle />

          {sessionUser ? <UserMenu user={sessionUser} /> : <Link className="btn btn-secondary btn-sm" href="/login">登录</Link>}

          <Link className="btn btn-primary btn-sm" href="/new">
            <i className="ri-upload-2-line" aria-hidden="true" />
            发布作品
          </Link>

          <button
            className="nav__hamburger"
            type="button"
            aria-label="打开菜单"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
        </div>
      </header>

      {drawerOpen ? (
        <div className={cn('nav__drawer-mask', 'open')} onClick={() => setDrawerOpen(false)}>
          <aside
            className={cn('nav__drawer', 'open')}
            role="dialog"
            aria-modal="true"
            aria-label="站点菜单"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="nav__drawer-head">
              <span className="t-label">导航</span>
              <button
                className="nav__drawer-close"
                type="button"
                aria-label="关闭菜单"
                onClick={() => setDrawerOpen(false)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="nav__drawer-links">
              {navItems.map((item) =>
                item.disabled ? (
                  <span
                    key={item.href}
                    className="nav__drawer-link"
                    aria-disabled="true"
                    style={{ opacity: 0.42, cursor: 'not-allowed' }}
                  >
                    {item.label}
                  </span>
                ) : (
                  <Link key={item.href} className={cn('nav__drawer-link')} href={item.href}>
                    {item.href === '/' ? <i className="ri-gallery-line" aria-hidden="true" /> : null}
                    {item.label}
                  </Link>
                ),
              )}
            </div>
            <div className="nav__drawer-actions">
              {sessionUser ? (
                <>
                  <div className="nav__drawer-user">
                    <Avatar name={sessionUser.nickname} />
                    <span className="nav__drawer-user-name">{sessionUser.nickname}</span>
                  </div>
                  <Link
                    className="nav__drawer-link"
                    href="/dashboard"
                    onClick={() => setDrawerOpen(false)}
                  >
                    我的作品
                  </Link>
                  {isAdmin ? (
                    <Link
                      className="nav__drawer-link"
                      href="/admin"
                      onClick={() => setDrawerOpen(false)}
                    >
                      后台管理
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setDrawerOpen(false);
                      void handleLogout();
                    }}
                  >
                    退出登录
                  </button>
                </>
              ) : (
                <Link className="btn btn-secondary" href="/login">
                  登录
                </Link>
              )}
              <Link className="btn btn-primary" href="/new" style={{ width: '100%' }}>
                <i className="ri-upload-2-line" aria-hidden="true" />
                发布作品
              </Link>
            </div>
            <div className="nav__drawer-foot">Core. Code. Create.</div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
