/**
 * 个人空间 Tab 导航（P3）。
 *
 * RSC：URL 是唯一真源（§7.2）——Tab 用 `<Link>` 全页导航（?tab=），
 * `aria-pressed` 由 active prop 派生，无客户端 tab 状态。
 * 复用 P1 已落地的 `.segment` + `.segment-link`，零新增 tab 样式。
 */

import Link from 'next/link';

import { DASHBOARD_TAB, type DashboardTab } from '@/lib/constants';

/** 组件属性。 */
export interface DashboardTabsProps {
  /** 当前激活 Tab（页面已归一化，非法值回落 published）。 */
  active: DashboardTab;
}

/** Tab 定义（href 即 URL 真源）。 */
const TABS: ReadonlyArray<{ key: DashboardTab; label: string; href: string }> = [
  { key: DASHBOARD_TAB.PUBLISHED, label: '我发布的', href: '/dashboard' },
  { key: DASHBOARD_TAB.JOINED, label: '我参与的活动', href: '/dashboard?tab=joined' },
  { key: DASHBOARD_TAB.FAVORITES, label: '收藏', href: '/dashboard?tab=favorites' },
];

/** 渲染 Tab 导航。 */
export function DashboardTabs({ active }: DashboardTabsProps): React.JSX.Element {
  return (
    <div className="segment dashboard-tabs" role="tablist" aria-label="我的作品导航">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          className="segment-link"
          href={tab.href}
          role="tab"
          aria-selected={active === tab.key}
          aria-pressed={active === tab.key}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
