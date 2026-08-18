'use client';

/**
 * 后台壳：侧栏分组导航（概览 / 内容 / 治理 / 系统）+ 内容区。
 *
 * 设计真源：docs/P2-后台管理设计.md §1.5。分组 + 内联 SVG 图标（currentColor）
 * 风格对齐「我的后台」DashboardShell（side__group / side__label / dash-side__item，
 * 零图标库依赖、零 hex）。`usePathname` 高亮当前项，挂在根布局下
 * （保留站点头部 Nav/Footer，Q5 最小变更）。
 */

import * as React from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';

/** 侧栏导航项。 */
interface AdminNavItem {
  href: string;
  label: string;
  /** 精确匹配（`/admin` 首页避免把 `/admin/projects` 也点亮）。 */
  exact?: boolean;
  /** 16px 线性图标（currentColor）。 */
  icon: React.ReactNode;
}

/** 概览 = 仪表盘四宫格。 */
const ICON_OVERVIEW = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

/** 作品管理 = 文档。 */
const ICON_PROJECTS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 3h7l4 4v14H7z" />
    <path d="M14 3v4h4" />
  </svg>
);

/** 活动管理 = 奖杯。 */
const ICON_CAMPAIGNS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);

/** 用户管理 = 人形。 */
const ICON_USERS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
);

/** 风控中心 = 盾牌。 */
const ICON_RISK = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l7 3v5c0 4.6-3 8.6-7 10-4-1.4-7-5.4-7-10V6l7-3Z" />
  </svg>
);

/** 清理中心 = 回收桶。 */
const ICON_CLEANUP = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16" />
    <path d="M9 7V5h6v2" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

/** 「概览」独立组（顶部，无分组标题）。 */
const OVERVIEW_GROUP: readonly AdminNavItem[] = [
  { href: '/admin', label: '概览', exact: true, icon: ICON_OVERVIEW },
];

/** 「内容」组。 */
const CONTENT_GROUP: readonly AdminNavItem[] = [
  { href: '/admin/projects', label: '作品管理', icon: ICON_PROJECTS },
  { href: '/admin/campaigns', label: '活动管理', icon: ICON_CAMPAIGNS },
];

/** 「治理」组。 */
const GOVERN_GROUP: readonly AdminNavItem[] = [
  { href: '/admin/users', label: '用户管理', icon: ICON_USERS },
  { href: '/admin/risk', label: '风控中心', icon: ICON_RISK },
  { href: '/admin/audit', label: '审计日志', icon: ICON_CLEANUP },
];

/** 「系统」组。 */
const SYSTEM_GROUP: readonly AdminNavItem[] = [
  { href: '/admin/cleanup', label: '清理中心', icon: ICON_CLEANUP },
];

/** 当前项是否高亮（精确项全等，其余按前缀）。 */
function isActive(pathname: string, item: AdminNavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

/** 渲染一组导航项（图标 + 文案，aria-current 精确标记当前页）。 */
function renderNavItems(pathname: string, items: readonly AdminNavItem[]): React.JSX.Element[] {
  return items.map((item) => {
    const active = isActive(pathname, item);
    return (
      <Link
        key={item.href}
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
  });
}

/** 后台壳组件。 */
export function AdminShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const pathname = usePathname();

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar admin-sidebar--admin">
        <div className="admin-sidebar__title">后台管理</div>
        <nav className="admin-sidebar__nav" aria-label="后台导航">
          <div className="dash-side__group">{renderNavItems(pathname, OVERVIEW_GROUP)}</div>
          <div className="dash-side__group">
            <div className="dash-side__label">内容</div>
            {renderNavItems(pathname, CONTENT_GROUP)}
          </div>
          <div className="dash-side__group">
            <div className="dash-side__label">治理</div>
            {renderNavItems(pathname, GOVERN_GROUP)}
          </div>
          <div className="dash-side__group">
            <div className="dash-side__label">系统</div>
            {renderNavItems(pathname, SYSTEM_GROUP)}
          </div>
        </nav>
        <div className="admin-sidebar__foot">运营与治理控制台</div>
      </aside>
      <div className="admin-content">{children}</div>
    </div>
  );
}
