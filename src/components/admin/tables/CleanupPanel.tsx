'use client';

/**
 * 后台清理中心面板（P2）—— client 组件。
 *
 * 「立即清理」按钮 → `POST /api/admin/cleanup/run`（运行中禁用态）→
 * 展示 CleanupRunResult 摘要 → 刷新日志列表；日志表格 + 分页。
 * 底部附「审计留痕」说明（P2 审计只写不展示，摘要提示存在性）。
 */

import * as React from 'react';

import { Pagination } from '@/components/admin/Pagination';
import { Badge, Button, Card, CardBody, Select, Table, TBody, Td, Th, THead, Tr, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatBytes, formatDateTime } from '@/lib/format';
import type { CleanupLogDTO } from '@/lib/types';

/** 清理任务动作选项。 */
const ACTION_OPTIONS = [
  { value: '', label: '全部动作' },
  { value: 'archive', label: '过期归档' },
  { value: 'purge', label: '回收站清除' },
  { value: 'tmp-gc', label: '临时目录回收' },
  { value: 'orphan-scan', label: '孤儿巡检' },
] as const;

/** 运行结果摘要。 */
interface RunSummary {
  batchId: string;
  totals: { scanned: number; affected: number; freedBytes: number; failures: number };
}

/** 组件入参。 */
export interface CleanupPanelProps {
  initialLogs: CleanupLogDTO[];
  initialPage: number;
  initialPageSize: number;
  initialTotal: number;
}

/** 动作中文文案。 */
function actionLabel(action: string): string {
  const map: Record<string, string> = {
    archive: '过期归档',
    purge: '回收站清除',
    'tmp-gc': '临时目录回收',
    'orphan-scan': '孤儿巡检',
    notify: '到期提醒',
  };
  return map[action] ?? action;
}

/** 清理中心面板。 */
export function CleanupPanel({
  initialLogs,
  initialPage,
  initialPageSize,
  initialTotal,
}: CleanupPanelProps): React.JSX.Element {
  const { toast } = useToast();

  const [action, setAction] = React.useState<string>('');
  const [page, setPage] = React.useState<number>(initialPage);
  const [pageSize] = React.useState<number>(initialPageSize);
  const [logs, setLogs] = React.useState<CleanupLogDTO[]>(initialLogs);
  const [total, setTotal] = React.useState<number>(initialTotal);
  const [running, setRunning] = React.useState<boolean>(false);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [summary, setSummary] = React.useState<RunSummary | null>(null);

  /** 拉取一页日志。 */
  const load = React.useCallback(
    async (nextPage: number, nextAction: string): Promise<void> => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (nextAction) params.set('action', nextAction);
        params.set('page', String(nextPage));
        params.set('pageSize', String(pageSize));

        const res = await fetch(`/api/admin/cleanup/logs?${params.toString()}`);
        const body = await res.json();
        if (!body.ok) {
          toast(body.error?.message ?? '加载失败', 'danger');
          return;
        }
        setLogs(body.data as CleanupLogDTO[]);
        setPage(body.meta.page as number);
        setTotal(body.meta.total as number);
      } catch {
        toast('网络异常，请稍后重试', 'danger');
      } finally {
        setLoading(false);
      }
    },
    [pageSize, toast],
  );

  const applyAction = (nextAction: string): void => {
    setAction(nextAction);
    void load(1, nextAction);
  };

  const changePage = (nextPage: number): void => {
    void load(nextPage, action);
  };

  /** 手动触发一轮完整清理。 */
  const runCleanup = async (): Promise<void> => {
    setRunning(true);
    setSummary(null);
    try {
      const res = await fetch('/api/admin/cleanup/run', { method: 'POST' });
      const body = await res.json();
      if (!body.ok) {
        toast(body.error?.message ?? '清理触发失败', 'danger');
        return;
      }
      const data = body.data as { batchId: string; totals: RunSummary['totals'] };
      setSummary({ batchId: data.batchId, totals: data.totals });
      toast(`清理完成：影响 ${data.totals.affected} 条，释放 ${formatBytes(data.totals.freedBytes)}`, 'success');
      void load(1, action);
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="admin-stack">
      <Card className="admin-card">
        <CardBody>
          <div className="admin-section-head">
            <h2 className="t-card-title">手动清理</h2>
          </div>
          <p className="t-body-sm muted" style={{ marginBottom: 14 }}>
            依次执行：过期归档（ARCHIVED + purgeAt）→ 回收站清除（PURGED + 删文件）→ 临时目录回收。
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={() => void runCleanup()} disabled={running}>
              {running ? '清理运行中…' : '立即清理'}
            </Button>
            {summary ? (
              <span className="t-body-sm">
                批次 <span className="mono">{summary.batchId.slice(0, 8)}</span> · 影响{' '}
                <strong>{summary.totals.affected}</strong> 条 · 释放{' '}
                <strong className="mono">{formatBytes(summary.totals.freedBytes)}</strong> · 失败{' '}
                <strong>{summary.totals.failures}</strong>
              </span>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card className="admin-card">
        <CardBody>
          <div className="admin-section-head">
            <h2 className="t-card-title">清理日志</h2>
            <Select
              className="admin-select-sm"
              aria-label="按动作筛选"
              value={action}
              onChange={(event) => applyAction(event.target.value)}
            >
              {ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="admin-table-scroll">
            <Table>
              <THead>
                <Tr>
                  <Th>动作</Th>
                  <Th>结果</Th>
                  <Th className="admin-table__num">释放字节</Th>
                  <Th>说明</Th>
                  <Th>时间</Th>
                </Tr>
              </THead>
              <TBody>
                {logs.length === 0 ? (
                  <Tr>
                    <Td colSpan={5} className="admin-table__empty">
                      {loading ? '加载中…' : '暂无清理日志'}
                    </Td>
                  </Tr>
                ) : (
                  logs.map((log) => (
                    <Tr key={log.id} className={cn(!log.success && 'admin-table__row--muted')}>
                      <Td>
                        <Badge tone={log.success ? 'live' : 'expiring'}>{actionLabel(log.action)}</Badge>
                      </Td>
                      <Td>
                        <Badge tone={log.success ? 'live' : 'blocked'}>{log.success ? '成功' : '失败'}</Badge>
                      </Td>
                      <Td className="admin-table__num">
                        <span className="mono">{formatBytes(log.freedBytes)}</span>
                      </Td>
                      <Td>
                        <span className="t-body-sm" title={log.message ?? ''}>
                          {log.message ?? '—'}
                        </span>
                      </Td>
                      <Td>
                        <span className="t-body-sm">{formatDateTime(log.createdAt)}</span>
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </div>

          <Pagination page={page} pageSize={pageSize} total={total} onChange={changePage} />
        </CardBody>
      </Card>

      <Card className="admin-card">
        <CardBody>
          <div className="admin-section-head">
            <h2 className="t-card-title">审计留痕</h2>
          </div>
          <p className="t-body-sm muted">
            后台全部写操作（下架 / 恢复 / 删除 / 续期 / 改可见性 / 置顶 / 封禁 / 清理触发）均写入审计日志
            （<span className="mono">admin.*</span>），含操作人、时间、前后快照。P2 阶段审计日志只记录、不提供查看页。
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
