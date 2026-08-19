/**
 * 后台标签管理页 `/admin/tags`（P3 标签系统）。
 *
 * 标签：后台预置库（自定义）+ 活动自动同步（类型=活动）。
 * 提供：新建 / 改名 / 排序（上移下移）/ 删除（仅自定义）/ 标签作品管理（解除关联）。
 */

import type { Metadata } from 'next';

import { TagsManager } from '@/components/admin/TagsManager';
import { requireAdmin } from '@/lib/auth';

export const metadata: Metadata = {
  title: '标签管理',
  description: '管理作品标签：增删改、排序与标签作品关联。',
};

export default async function AdminTagsPage() {
  await requireAdmin();

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="t-headline">标签管理</h1>
          <p className="t-body-sm muted">
            自定义标签供发布/编辑作品时选择；活动创建时自动同步为标签（类型=活动，不可删改）。
          </p>
        </div>
      </div>
      <TagsManager />
    </div>
  );
}
