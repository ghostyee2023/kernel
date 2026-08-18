/**
 * 后台作品管理页 `/admin/projects`（P2）—— Server Component。
 *
 * SSR 首屏 `listProjects({page:1,pageSize:20})` → `initialRows` 传入
 * 客户端 `ProjectsTable`；筛选 / 翻页 / 操作在 client 侧走 `/api/admin/*`。
 */

import * as React from 'react';

import { ProjectsTable } from '@/components/admin/tables/ProjectsTable';
import { listProjects } from '@/lib/admin-service';

export const dynamic = 'force-dynamic';

/** 作品管理页：筛选条 + 表格 + 分页 + 行操作。 */
export default async function AdminProjectsPage(): Promise<React.JSX.Element> {
  const initial = await listProjects({ page: 1, pageSize: 20 });

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="t-headline">作品管理</h1>
          <p className="t-body-sm muted">筛选、下架、恢复、物理删除、续期、可见性与置顶</p>
        </div>
      </div>
      <ProjectsTable
        initialRows={initial.items}
        initialPage={initial.page}
        initialPageSize={initial.pageSize}
        initialTotal={initial.total}
      />
    </div>
  );
}
