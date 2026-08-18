/**
 * 后台概览页 `/admin`（P2）—— Server Component。
 *
 * 首屏直调 `adminService.overview()` + `listCleanupLogs({pageSize:8})`（并行），
 * 不 fetch 自己的 `/api`（对齐 §7.5 数据获取约定）。
 */

import * as React from 'react';

import Link from 'next/link';

import { MetricCard } from '@/components/admin/MetricCard';
import { Badge, Card, CardBody } from '@/components/ui';
import { listCleanupLogs, overview } from '@/lib/admin-service';
import { formatBytes, formatCount, formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** 概览页：6 张指标卡 + 最近清理日志。 */
export default async function AdminOverviewPage(): Promise<React.JSX.Element> {
  const [metrics, recentLogs] = await Promise.all([
    overview(),
    listCleanupLogs({ page: 1, pageSize: 8 }),
  ]);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="t-headline">概览</h1>
          <p className="t-body-sm muted">全站关键指标一览</p>
        </div>
      </div>

      <div className="admin-metrics">
        <MetricCard label="总作品" value={formatCount(metrics.projects.total)} hint={`在线 ${formatCount(metrics.projects.active)}`} tone="primary" />
        <MetricCard label="在线" value={formatCount(metrics.projects.active)} hint={`已归档 ${formatCount(metrics.projects.archived)}`} tone="success" />
        <MetricCard label="已归档" value={formatCount(metrics.projects.archived)} hint={`已清除 ${formatCount(metrics.projects.purged)}`} tone="warning" />
        <MetricCard label="投票总数" value={formatCount(metrics.votes)} hint="全站累计" tone="magenta" />
        <MetricCard label="用户数" value={formatCount(metrics.users.total)} hint={`封禁 ${formatCount(metrics.users.banned)}`} tone="cyan" />
        <MetricCard label="存储用量" value={formatBytes(metrics.storageBytes)} hint="≈ 磁盘占用" tone="gold" />
      </div>

      <Card className="admin-card">
        <CardBody>
          <div className="admin-section-head">
            <h2 className="t-card-title">最近清理日志</h2>
            <Link className="btn btn-ghost btn-sm" href="/admin/cleanup">
              查看全部
            </Link>
          </div>
          {recentLogs.items.length === 0 ? (
            <p className="t-body-sm muted" style={{ padding: '12px 0' }}>
              暂无清理记录
            </p>
          ) : (
            <ul className="admin-log-list">
              {recentLogs.items.map((log) => (
                <li key={log.id} className="admin-log-item">
                  <Badge tone={log.success ? 'live' : 'expiring'}>{log.action}</Badge>
                  <span className="mono admin-log-item__batch">{log.batchId.slice(0, 8)}</span>
                  <span className="t-body-sm muted admin-log-item__msg">{log.message ?? '—'}</span>
                  <span className="t-caption muted">{formatDateTime(log.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
