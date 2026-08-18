/**
 * 后台布局 —— ADMIN 鉴权门 + AdminShell 侧栏（P2 后台）。
 *
 * 铁律（docs/P2-后台管理设计.md §1.2）：页面层统一门禁，
 * 非 ADMIN 一律 `redirect('/login?next=/admin')`；子页面不再重复鉴权。
 *
 * Q5：沿用根布局（保留站点头部 Nav/Footer），内容区内嵌 AdminShell 侧栏。
 */

import * as React from 'react';

import { redirect } from 'next/navigation';

import { AdminShell } from '@/components/admin/AdminShell';
import { getSession, isAdminRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }): Promise<React.JSX.Element> {
  const session = await getSession();
  if (!session || !isAdminRole(session.role)) {
    redirect('/login?next=/admin');
  }
  return <AdminShell>{children}</AdminShell>;
}
