/**
 * 后台审计日志页 `/admin/audit`（P2 补）—— Server Component。
 *
 * SSR 直调 `listAuditLogs`：时间 / 操作者 / 动作 / 目标 / 详情 / IP 表格；
 * 支持 `?action=` 与 `?username=` 筛选（GET 表单提交）与分页。
 */

import * as React from 'react';

import { Badge } from '@/components/ui';
import { listAuditLogs } from '@/lib/admin-service';
import { AUDIT_ACTION_LABEL } from '@/lib/constants';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** 页面参数。 */
type PageProps = { searchParams: Promise<Record<string, string | undefined>> };

/** 渲染分页链接。 */
function pageLink(searchParams: Record<string, string | undefined>, page: number): string {
  const params = new URLSearchParams();
  if (searchParams.action) params.set('action', searchParams.action);
  if (searchParams.username) params.set('username', searchParams.username);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs === '' ? '/admin/audit' : `/admin/audit?${qs}`;
}

/** 审计日志页。 */
export default async function AdminAuditPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const result = await listAuditLogs({
    page,
    pageSize: 20,
    action: sp.action,
    username: sp.username,
  });

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="t-headline">审计日志</h1>
          <p className="t-body-sm muted">管理员操作的留痕记录（仅写入增强能力，读取本地实时）</p>
        </div>
      </div>

      {/* 筛选 */}
      <form
        className="filterbar__inner"
        method="get"
        action="/admin/audit"
        style={{ padding: '14px 0', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <select name="action" defaultValue={sp.action ?? ''} className="segment">
          <option value="">全部动作</option>
          {Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="username"
          defaultValue={sp.username ?? ''}
          placeholder="按操作者用户名筛选"
          style={{ height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--surface-canvas)', color: 'var(--text-primary)' }}
        />
        <button type="submit" className="btn btn-secondary">
          筛选
        </button>
      </form>

      {/* 表格 */}
      {result.items.length === 0 ? (
        <p className="muted" style={{ padding: '32px 0' }}>
          暂无审计日志。
        </p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作者</th>
                <th>动作</th>
                <th>目标</th>
                <th>说明</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((log) => (
                <tr key={log.id}>
                  <td className="mono" title={log.createdAt}>
                    {formatDateTime(log.createdAt)}
                  </td>
                  <td>{log.actorName}</td>
                  <td>
                    <Badge tone="campaign">{AUDIT_ACTION_LABEL[log.action as keyof typeof AUDIT_ACTION_LABEL] ?? log.action}</Badge>
                  </td>
                  <td className="mono muted">
                    {log.targetType}:{log.targetId.slice(0, 10)}
                  </td>
                  <td className="t-body-sm">{log.detail ?? '—'}</td>
                  <td className="mono muted">{log.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 ? (
        <div className="pager">
          <span className="pager__info">
            第 {result.page} / {totalPages} 页 · 共 {result.total} 条
          </span>
          <a className="btn btn-secondary" aria-disabled={result.page <= 1} href={pageLink(sp, result.page - 1)}>
            上一页
          </a>
          <a className="btn btn-secondary" aria-disabled={result.page >= totalPages} href={pageLink(sp, result.page + 1)}>
            下一页
          </a>
        </div>
      ) : null}
    </div>
  );
}
