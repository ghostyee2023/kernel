/**
 * 后台新建活动 `/admin/campaigns/new`（P1 活动模块）—— Server Component 壳。
 *
 * 表单交互全在客户端 `CampaignForm`（create 模式）；创建成功后跳编辑页。
 * 鉴权由 admin/layout 统一门禁。
 */

import * as React from 'react';

import { CampaignForm } from '@/components/admin/campaigns/CampaignForm';

export const dynamic = 'force-dynamic';

/** 新建活动页。 */
export default function AdminCampaignNewPage(): React.JSX.Element {
  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="t-headline">新建活动</h1>
          <p className="t-body-sm muted">创建后进入编辑页，可继续调整规则与推进状态</p>
        </div>
      </div>
      <CampaignForm />
    </div>
  );
}
