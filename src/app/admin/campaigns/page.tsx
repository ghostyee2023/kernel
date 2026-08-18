/**
 * 后台活动管理 `/admin/campaigns`（P1 活动模块）—— Server Component。
 *
 * SSR 首屏 `campaignService.list({ page, pageSize:20, includeDraft:true })` →
 * 传入客户端 `CampaignsTable`（含 draft，分页写回 searchParams）。
 * 鉴权由 admin/layout 统一门禁。
 */

import * as React from 'react';

import Link from 'next/link';

import { CampaignsTable } from '@/components/admin/tables/CampaignsTable';
import { Button } from '@/components/ui';
import * as campaignService from '@/lib/campaign-service';

export const dynamic = 'force-dynamic';

/** 页面参数（Next 15 起 searchParams 为 Promise）。 */
type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** 从 searchParams 取单值字符串。 */
function single(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** 后台活动管理页。 */
export default async function AdminCampaignsPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const parsedPage = Number.parseInt(single(sp.page), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const result = await campaignService.list({ page, pageSize: 20, includeDraft: true });

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="t-headline">活动管理</h1>
          <p className="t-body-sm muted">创建活动、推进状态、管理报名作品；操作均写入审计日志</p>
        </div>
        <Link href="/admin/campaigns/new">
          <Button variant="primary" size="sm">
            新建活动
          </Button>
        </Link>
      </div>
      <CampaignsTable
        initialRows={result.items}
        initialPage={result.page}
        initialPageSize={result.pageSize}
        initialTotal={result.total}
      />
    </div>
  );
}
