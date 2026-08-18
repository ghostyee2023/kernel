/**
 * 后台风控中心 `/admin/risk`（P2 风控模块）—— Server Component。
 *
 * SSR 首屏直调 `riskService.auditGroups({group:'ip',page:1})` + `auditSummary`
 * + `campaignService.list`（活动筛选用），不 fetch 自己的 `/api`（对齐 §7.5 约定）；
 * 交互（筛选 / 明细 / 作废）在客户端 RiskAuditPanel 完成。鉴权由 admin/layout 统一门禁。
 */

import * as React from 'react';

import { RiskAuditPanel } from '@/components/admin/risk/RiskAuditPanel';
import * as campaignService from '@/lib/campaign-service';
import { ADMIN_DEFAULT_PAGE_SIZE } from '@/lib/constants';
import * as riskService from '@/lib/risk-service';

export const dynamic = 'force-dynamic';

/** 风控中心页。 */
export default async function AdminRiskPage(): Promise<React.JSX.Element> {
  const [initialGroups, initialSummary, campaigns] = await Promise.all([
    riskService.auditGroups({ group: 'ip', page: 1, pageSize: ADMIN_DEFAULT_PAGE_SIZE }),
    riskService.auditSummary({ group: 'ip' }),
    campaignService.list({ includeDraft: true, pageSize: 100 }),
  ]);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="t-headline">风控中心</h1>
          <p className="t-body-sm muted">可疑票聚合审计 · 批量作废 · 榜单自动重算；操作均写入审计日志</p>
        </div>
      </div>
      <RiskAuditPanel
        initialGroups={initialGroups.items}
        initialSummary={initialSummary}
        initialTotal={initialGroups.total}
        campaigns={campaigns.items.map((campaign) => ({ id: campaign.id, title: campaign.title }))}
      />
    </div>
  );
}
