/**
 * 后台用户管理页 `/admin/users`（P2）—— Server Component。
 *
 * SSR 首屏 `listUsers` → `initialRows` 传入 `UsersTable`；封禁 / 解封在
 * client 侧走 `POST /api/admin/users/:id/ban`。`currentUserId` 用于禁用「封禁自己」。
 */

import * as React from 'react';

import { UsersTable } from '@/components/admin/tables/UsersTable';
import { listUsers } from '@/lib/admin-service';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** 用户管理页。 */
export default async function AdminUsersPage(): Promise<React.JSX.Element> {
  const [session, initial] = await Promise.all([getSession(), listUsers({ page: 1, pageSize: 20 })]);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="t-headline">用户管理</h1>
          <p className="t-body-sm muted">查看用户与作品数，封禁 / 解封（管理员账号不可被封禁）</p>
        </div>
      </div>
      <UsersTable
        initialRows={initial.items}
        initialPage={initial.page}
        initialPageSize={initial.pageSize}
        initialTotal={initial.total}
        currentUserId={session?.userId ?? ''}
      />
    </div>
  );
}
