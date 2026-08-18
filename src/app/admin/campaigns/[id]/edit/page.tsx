/**
 * 后台编辑活动 `/admin/campaigns/[id]/edit`（P1 活动模块）—— Server Component。
 *
 * 直调 `campaignService.getById()` + `listJoinedProjects()`：
 * 左侧活动表单（改规则/推进状态），右侧报名作品管理（行内移除）。
 * draft 活动也可进入编辑（后台不暴露给公开侧）。
 */

import * as React from 'react';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CampaignForm } from '@/components/admin/campaigns/CampaignForm';
import { CampaignProjectsManager } from '@/components/admin/campaigns/CampaignProjectsManager';
import * as campaignService from '@/lib/campaign-service';
import { AppError, ERROR_CODE } from '@/lib/response';

export const dynamic = 'force-dynamic';

/** 页面参数。 */
type PageProps = { params: Promise<{ id: string }> };

/** 编辑活动页。 */
export default async function AdminCampaignEditPage({ params }: PageProps): Promise<React.JSX.Element> {
  const { id } = await params;

  let detail;
  try {
    detail = await campaignService.getById(id);
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODE.CAMP_NOT_FOUND) notFound();
    throw error;
  }

  const projects = await campaignService.listJoinedProjects(id);

  return (
    <div className="admin-page">
      <nav className="breadcrumb" aria-label="面包屑" style={{ paddingTop: 0 }}>
        <Link href="/admin/campaigns">活动管理</Link>
        <span aria-hidden="true">/</span>
        <span>{detail.title}</span>
      </nav>

      <div className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="t-headline">编辑活动</h1>
          <p className="t-body-sm muted">
            当前状态：{detail.status}
            {detail.storedStatus !== detail.status ? `（存储态 ${detail.storedStatus}，由时间窗懒计算推进）` : ''}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        <CampaignForm campaignId={detail.id} initial={detail} />
        <div>
          <div className="admin-section-head">
            <h2 className="t-card-title">报名作品管理</h2>
          </div>
          <CampaignProjectsManager campaignId={detail.id} initialProjects={projects} />
        </div>
      </div>
    </div>
  );
}
