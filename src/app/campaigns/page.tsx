/**
 * 活动广场 `/campaigns`（P1 活动模块）。
 *
 * Server Component 直调 `campaignService.list()`：首屏即完整 HTML。
 * 状态筛选（全部/征集/投票/结束）放在 URL 上；`status` 为懒计算 effective。
 * draft 一律不出现。
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { CampaignGrid } from '@/components/campaign';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatCount } from '@/lib/format';
import * as campaignService from '@/lib/campaign-service';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '活动广场',
  description: 'Kernel 社区活动：征集报名、投票评选、实时榜单。',
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

/** 状态筛选 Tab。 */
const STATUS_TABS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  { value: 'collecting', label: '征集报名中' },
  { value: 'voting', label: '投票中' },
  { value: 'ended', label: '已结束' },
] as const;

/** 渲染活动广场。 */
export default async function CampaignsPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const status = single(sp.status);
  const parsedPage = Number.parseInt(single(sp.page), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const result = await campaignService.list({
    status: status === '' ? undefined : status,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  return (
    <div className="container-wide camp-page">
      <header className="camp-hero">
        <span className="badge badge--live">
          <span className="dot dot-live" aria-hidden="true" />
          社区活动
        </span>
        <h1 className="camp-hero__title">活动广场</h1>
        <p className="camp-hero__sub">
          征集、投票、上榜 —— 共 {formatCount(result.total)} 场活动正在生长。
        </p>
      </header>

      <div className="camp-tags" role="group" aria-label="活动状态筛选">
        {STATUS_TABS.map((tab) => {
          const active = status === tab.value;
          const href = tab.value === '' ? '/campaigns' : `/campaigns?status=${tab.value}`;
          return (
            <Link key={tab.value} className="tag" aria-pressed={active} href={href}>
              {tab.label}
            </Link>
          );
        })}
      </div>

      <CampaignGrid
        campaigns={result.items}
        emptyTitle={status === '' ? '还没有活动' : '该状态下暂无活动'}
        emptyDescription={
          status === ''
            ? '管理员创建活动后，会展示在这里。'
            : '换个状态看看，或稍后再来。'
        }
      />
    </div>
  );
}
