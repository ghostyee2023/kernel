/**
 * 我的后台 `/dashboard`（P3.5）—— Server Component。
 *
 * - requireUser 门禁：未登录 `redirect('/login?next=/dashboard')`（对齐 admin/layout 模式）；
 * - URL 驱动 5 页：`?page=overview|myprojects|myvotes|settings|favorites`，非法/缺省回落 overview（不 404）；
 * - 老链接兼容（Q1，本地兼容解析不 301）：`?tab=published→myprojects`、`?tab=favorites→favorites`、
 *   `?tab=joined→overview`；归一化顺序 = 先读 ?page=，缺省/非法再读 ?tab= 映射；
 * - 各页内容 SSR 直调领域服务（禁止在 Server Component 里 fetch 自家 /api，§7.7）；
 * - 计数类数据（KPI / 存储）只在 overview 页取，其它页不再重复聚合（§1.3）。
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  DashboardShell,
  FavoritesPanel,
  MyProjectsPanel,
  MyVotesPanel,
  OverviewPanel,
  SettingsPanel,
} from '@/components/dashboard';
import { getSession } from '@/lib/auth';
import * as campaignService from '@/lib/campaign-service';
import { DASHBOARD_PAGE, type DashboardPage } from '@/lib/constants';
import * as favoriteService from '@/lib/favorite-service';
import { prisma } from '@/lib/prisma';
import * as projectService from '@/lib/project-service';
import * as voteService from '@/lib/vote-service';
import type { AccountInfo } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '我的后台',
  description: '管理你发布的作品、投票、收藏与账号。',
};

/** 页面参数（Next 15 起 searchParams 为 Promise）。 */
type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** 从 searchParams 取单值字符串。 */
function single(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * 归一化 page：先读 `?page=`（5 值，非法回落 overview）→ 缺省/非法时读 `?tab=` 兼容映射
 * （published→myprojects / favorites→favorites / joined→overview）→ 都没有回落 overview。
 * 本地兼容解析、不强制 301（Q1，本地桩无 SEO 需求）。
 */
function normalizePage(pageValue: string, tabValue: string): DashboardPage {
  if (pageValue === DASHBOARD_PAGE.MY_PROJECTS) return DASHBOARD_PAGE.MY_PROJECTS;
  if (pageValue === DASHBOARD_PAGE.MY_VOTES) return DASHBOARD_PAGE.MY_VOTES;
  if (pageValue === DASHBOARD_PAGE.SETTINGS) return DASHBOARD_PAGE.SETTINGS;
  if (pageValue === DASHBOARD_PAGE.FAVORITES) return DASHBOARD_PAGE.FAVORITES;
  if (pageValue === DASHBOARD_PAGE.OVERVIEW) return DASHBOARD_PAGE.OVERVIEW;

  if (tabValue === 'published') return DASHBOARD_PAGE.MY_PROJECTS;
  if (tabValue === 'favorites') return DASHBOARD_PAGE.FAVORITES;
  if (tabValue === 'joined') return DASHBOARD_PAGE.OVERVIEW;
  return DASHBOARD_PAGE.OVERVIEW;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session) redirect('/login?next=/dashboard');
  const userId = session.userId;

  const sp = await searchParams;
  const page = normalizePage(single(sp.page), single(sp.tab));
  console.log(`[dashboard][page] userId=${userId} page=${page}`);

  let content: React.ReactNode;
  if (page === DASHBOARD_PAGE.MY_PROJECTS) {
    const mine = await projectService.listMine(userId);
    content = <MyProjectsPanel initialRows={mine} />;
  } else if (page === DASHBOARD_PAGE.MY_VOTES) {
    const [votesOut, votesIn] = await Promise.all([
      voteService.myVotesFull(userId),
      voteService.votesReceivedByProject(userId),
    ]);
    content = <MyVotesPanel votesOut={votesOut} votesIn={votesIn} />;
  } else if (page === DASHBOARD_PAGE.SETTINGS) {
    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, nickname: true, role: true, createdAt: true, passwordHash: true },
    });
    const account: AccountInfo | null = userRow
      ? {
          username: userRow.username ?? '',
          nickname: userRow.nickname,
          role: userRow.role,
          createdAt: userRow.createdAt.toISOString(),
          // 不透出 hash，仅转布尔供前端判断「是否已设密码」
          hasPassword: userRow.passwordHash !== null,
        }
      : null;
    content = <SettingsPanel user={account} />;
  } else if (page === DASHBOARD_PAGE.FAVORITES) {
    const [favorites, favoriteIds] = await Promise.all([
      favoriteService.list(userId),
      favoriteService.myFavoriteIds(userId),
    ]);
    content = <FavoritesPanel initialProjects={favorites} initialFavoritedIds={favoriteIds} />;
  } else {
    // overview（默认落地页）：欢迎头 + 4 KPI + 存储面板 + 最近作品（前 5 条）
    const [nicknameRow, stats, joinedCount, allMine] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { nickname: true } }),
      projectService.myStats(userId),
      campaignService.countJoinedByUser(userId),
      projectService.listMine(userId),
    ]);
    const nickname = nicknameRow?.nickname ?? session.username;
    content = (
      <OverviewPanel
        stats={stats}
        joinedCount={joinedCount}
        recentProjects={allMine.slice(0, 5)}
        nickname={nickname}
        role={session.role}
      />
    );
  }

  return <DashboardShell activePage={page}>{content}</DashboardShell>;
}
