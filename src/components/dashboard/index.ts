/**
 * 我的后台（dashboard）组件桶导出（P3.5）。
 *
 * - 侧栏替代了旧 DashboardTabs（不再导出，文件保留未引用）；
 * - JoinedCampaignsList 不再被 page 引用（Q5：?tab=joined 兼容到 overview，活动参与由
 *   KPI「参与活动数」表达），保留文件不导出，可随时加回。
 */
export { DashboardShell } from './DashboardShell';
export type { DashboardShellProps } from './DashboardShell';

export { FavoritesPanel } from './FavoritesPanel';
export type { FavoritesPanelProps } from './FavoritesPanel';

export { MyProjectsPanel } from './MyProjectsPanel';
export type { MyProjectsPanelProps } from './MyProjectsPanel';

export { MyVotesPanel } from './MyVotesPanel';
export type { MyVotesPanelProps } from './MyVotesPanel';

export { OverviewPanel } from './OverviewPanel';
export type { OverviewPanelProps } from './OverviewPanel';

export { SettingsPanel } from './SettingsPanel';
export type { SettingsPanelProps } from './SettingsPanel';
