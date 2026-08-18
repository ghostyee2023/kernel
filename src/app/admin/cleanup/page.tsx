/**
 * 后台清理中心页 `/admin/cleanup`（P2）—— Server Component。
 *
 * SSR 首屏 `listCleanupLogs` → `initialLogs` 传入 `CleanupPanel`；
 * 手动触发在 client 侧走 `POST /api/admin/cleanup/run`（会话鉴权）。
 */

import * as React from 'react';

import { CleanupPanel } from '@/components/admin/tables/CleanupPanel';
import { listCleanupLogs } from '@/lib/admin-service';

export const dynamic = 'force-dynamic';

/** 清理中心页。 */
export default async function AdminCleanupPage(): Promise<React.JSX.Element> {
  const initial = await listCleanupLogs({ page: 1, pageSize: 20 });

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="t-headline">清理中心</h1>
          <p className="t-body-sm muted">手动触发过期归档 / 回收站清除 / 临时目录回收</p>
        </div>
      </div>
      <CleanupPanel
        initialLogs={initial.items}
        initialPage={initial.page}
        initialPageSize={initial.pageSize}
        initialTotal={initial.total}
      />
    </div>
  );
}
