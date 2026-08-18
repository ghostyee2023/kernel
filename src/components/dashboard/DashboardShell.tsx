'use client';

/**
 * 我的后台侧栏壳（P3.5）—— client 组件。
 *
 * 设计真源：docs/P3-我的后台设计.md §1.2 / §7.1。
 * 视觉基准：prototype #view-dashboard（1628-1661 行 side__group 分组）。
 *
 * - 直接复用 `.admin-shell / .admin-sidebar / .admin-content` 布局类（零新增布局逻辑，
 *   移动端 ≤767px 自动折叠为横向滚动）；侧栏内部按原型分组：我的（概览/我的作品/我的投票/
 *   账户设置/收藏）+ 快捷（发布新作品 → /new、浏览作品广场 → /）。
 * - 高亮：`activePage` 由 RSC 归一化后注入（?page= 缺省/非法 = overview），
 *   每项 `aria-current="page"` 精确匹配；快捷组不参与高亮。
 * - 内联 SVG 图标全部 `currentColor`（零图标库依赖，零 hex）。
 */

import * as React from 'react';

import Link from 'next/link';

import { cn } from '@/lib/cn';
import { DASHBOARD_PAGE, type DashboardPage } from '@/lib/constants';

/** 侧栏「我的」组导航项。 */
interface DashNavItem {
  key: DashboardPage;
  href: string;
  label: string;
  icon: React.ReactNode;
}

/** 侧栏「快捷」组导航项（不参与高亮）。 */
interface DashQuickItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

/** 「我的」组 5 项（图标对齐原型 1634-1648 行）。 */
const MY_GROUP: readonly DashNavItem[] = [
  {
    key: DASHBOARD_PAGE.OVERVIEW,
    href: '/dashboard',
    label: '概览',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    key: DASHBOARD_PAGE.MY_PROJECTS,
    href: '/dashboard?page=myprojects',
    label: '我的作品',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M4 4h16v16H4z" />
        <path d="M4 9h16" />
      </svg>
    ),
  },
  {
    key: DASHBOARD_PAGE.MY_VOTES,
    href: '/dashboard?page=myvotes',
    label: '我的投票',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.5 12 20 12 20Z" />
      </svg>
    ),
  },
  {
    key: DASHBOARD_PAGE.SETTINGS,
    href: '/dashboard?page=settings',
    label: '账户设置',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <circle cx="12" cy="8" r="3.4" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
    ),
  },
  {
    key: DASHBOARD_PAGE.FAVORITES,
    href: '/dashboard?page=favorites',
    label: '收藏',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
        <path d="M12 3.6l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8L12 3.6Z" />
      </svg>
    ),
  },
];

/** 「快捷」组 2 项（≤767px 隐藏；站点头部 Nav 已有「发布作品」与 Logo→广场，语义不丢）。 */
const QUICK_GROUP: readonly DashQuickItem[] = [
  {
    href: '/new',
    label: '发布新作品',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
  {
    href: '/',
    label: '浏览作品广场',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3-3" />
      </svg>
    ),
  },
];

/** 组件属性。 */
export interface DashboardShellProps {
  /** RSC 归一化后的当前页（?page= 缺省/非法 = overview），用于侧栏高亮。 */
  activePage: DashboardPage;
  children: React.ReactNode;
}

/** 我的后台侧栏壳。 */
export function DashboardShell({ activePage, children }: DashboardShellProps): React.JSX.Element {
  return (
    <div className="admin-shell dash-shell">
      <aside className="admin-sidebar dash-sidebar">
        <nav className="admin-sidebar__nav" aria-label="我的后台导航">
          <div className="dash-side__group">
            <div className="dash-side__label">我的</div>
            {MY_GROUP.map((item) => {
              const active = activePage === item.key;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={cn('admin-sidebar__link dash-side__item', active && 'active')}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="dash-side__ico" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="dash-side__group dash-side__group--quick">
            <div className="dash-side__label">快捷</div>
            {QUICK_GROUP.map((item) => (
              <Link key={item.href} href={item.href} className="admin-sidebar__link dash-side__item">
                <span className="dash-side__ico" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      </aside>
      <div className="admin-content">{children}</div>
    </div>
  );
}
