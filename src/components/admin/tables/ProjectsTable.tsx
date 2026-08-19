'use client';

/**
 * 后台作品管理表格（P2）—— 自包含 client 组件。
 *
 * 数据流：SSR 首屏 `initialRows` → 本地 state；筛选 / 翻页 / 行操作
 * 走 `/api/admin/*`，成功后 `toast` + 本地刷新 + `router.refresh()`。
 *
 * 行操作统一走 `POST /api/admin/projects/batch`（operation + ids + payload，
 * 单行操作 = ids:[id]）；BLOCK / PURGE / 续期必须过 ConfirmDialog 二次确认。
 */

import * as React from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Pagination } from '@/components/admin/Pagination';
import { Badge, Button, Input, Select, Table, TBody, Td, Th, THead, Tr, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { describeExpiry, formatCount, formatDate } from '@/lib/format';
import type { AdminBatchInput, AdminBatchOperation, AdminBatchResult, AdminProjectDTO } from '@/lib/types';

/** 筛选状态选项。 */
const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'ACTIVE', label: '在线' },
  { value: 'ARCHIVED', label: '已归档' },
  { value: 'BLOCKED', label: '已下架' },
  { value: 'PURGED', label: '已清除' },
] as const;

/** 筛选可见性选项。 */
const VISIBILITY_OPTIONS = [
  { value: '', label: '全部可见性' },
  { value: 'PUBLIC', label: '公开' },
  { value: 'UNLISTED', label: '不公开列出' },
  { value: 'PRIVATE', label: '私密' },
] as const;

/** 排序选项。 */
const SORT_OPTIONS = [
  { value: 'createdAt', label: '最新创建' },
  { value: 'expireAt', label: '即将到期' },
  { value: 'voteCount', label: '票数最多' },
] as const;

/** 续期档位（与 constants.TTL_OPTIONS 一致）。 */
const TTL_OPTIONS = [7, 30, 90, 180, 365] as const;

/** 二次确认状态。 */
interface ConfirmState {
  operation: AdminBatchOperation;
  ids: string[];
  payload?: AdminBatchInput['payload'];
  title: string;
  description: React.ReactNode;
  danger: boolean;
  confirmText: string;
}

/** 组件入参（SSR 首屏数据）。 */
export interface ProjectsTableProps {
  initialRows: AdminProjectDTO[];
  initialPage: number;
  initialPageSize: number;
  initialTotal: number;
}

/** 状态 → Badge tone。 */
function statusTone(status: string): 'live' | 'archived' | 'blocked' {
  if (status === 'ACTIVE') return 'live';
  if (status === 'BLOCKED') return 'blocked';
  return 'archived';
}

/** 状态中文文案。 */
function statusLabel(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: '在线',
    ARCHIVED: '已归档',
    BLOCKED: '已下架',
    PURGED: '已清除',
  };
  return map[status] ?? status;
}

/** 可见性 → Badge tone。 */
function visibilityTone(visibility: string): 'live' | 'unlisted' | 'private' {
  if (visibility === 'UNLISTED') return 'unlisted';
  if (visibility === 'PRIVATE') return 'private';
  return 'live';
}

/** 可见性中文文案。 */
function visibilityLabel(visibility: string): string {
  const map: Record<string, string> = { PUBLIC: '公开', UNLISTED: '不公开列出', PRIVATE: '私密' };
  return map[visibility] ?? visibility;
}

/** 作品管理表格。 */
export function ProjectsTable({
  initialRows,
  initialPage,
  initialPageSize,
  initialTotal,
}: ProjectsTableProps): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();

  const [filters, setFilters] = React.useState({ status: '', visibility: '', q: '', sort: 'createdAt' });
  const [page, setPage] = React.useState<number>(initialPage);
  const [pageSize] = React.useState<number>(initialPageSize);
  const [rows, setRows] = React.useState<AdminProjectDTO[]>(initialRows);
  const [total, setTotal] = React.useState<number>(initialTotal);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [busy, setBusy] = React.useState<boolean>(false);
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null);

  /** 按条件拉取一页数据并替换列表。 */
  const load = React.useCallback(
    async (nextPage: number, nextFilters: typeof filters): Promise<void> => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (nextFilters.status) params.set('status', nextFilters.status);
        if (nextFilters.visibility) params.set('visibility', nextFilters.visibility);
        if (nextFilters.q.trim()) params.set('q', nextFilters.q.trim());
        params.set('sort', nextFilters.sort);
        params.set('page', String(nextPage));
        params.set('pageSize', String(pageSize));

        const res = await fetch(`/api/admin/projects?${params.toString()}`);
        const body = await res.json();
        if (!body.ok) {
          toast(body.error?.message ?? '加载失败', 'danger');
          return;
        }
        setRows(body.data as AdminProjectDTO[]);
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

  /** 筛选变化：重置到第 1 页并拉取。 */
  const applyFilters = (next: typeof filters): void => {
    setFilters(next);
    void load(1, next);
  };

  /** 翻页。 */
  const changePage = (nextPage: number): void => {
    void load(nextPage, filters);
  };

  /** 执行批量操作：逐条成功/失败由服务端聚合，失败不中断整批。 */
  const runBatch = async (
    operation: AdminBatchOperation,
    ids: string[],
    payload?: AdminBatchInput['payload'],
  ): Promise<void> => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/projects/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation, ids, payload }),
      });
      const body = await res.json();
      if (!body.ok) {
        toast(body.error?.message ?? '操作失败', 'danger');
        return;
      }
      const result = body.data as AdminBatchResult;
      if (result.failCount > 0) {
        const firstFail = result.results.find((item) => !item.ok);
        toast(
          `成功 ${result.successCount} 条，失败 ${result.failCount} 条${firstFail?.message ? `：${firstFail.message}` : ''}`,
          'danger',
        );
      } else {
        toast(`操作成功（${result.successCount} 条）`, 'success');
      }
      void load(page, filters);
      router.refresh();
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  /** 打开二次确认。 */
  const askConfirm = (state: ConfirmState): void => setConfirm(state);

  /** 行内续期：选档位后弹确认。 */
  const handleRenew = (row: AdminProjectDTO, ttlDays: number): void => {
    askConfirm({
      operation: 'renew',
      ids: [row.id],
      payload: { ttlDays },
      title: '续期作品',
      description: `将「${row.title}」（${row.slug}）的有效期延长 ${ttlDays} 天；已归档作品会自动复活。`,
      danger: false,
      confirmText: '确认续期',
    });
  };

  return (
    <div className="admin-table-wrap">
      <div className="admin-filter-bar">
        <Select
          aria-label="按状态筛选"
          value={filters.status}
          onChange={(event) => applyFilters({ ...filters, status: event.target.value })}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="按可见性筛选"
          value={filters.visibility}
          onChange={(event) => applyFilters({ ...filters, visibility: event.target.value })}
        >
          {VISIBILITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Input
          className="admin-filter-bar__q"
          placeholder="搜索 slug / 标题 / 作者"
          value={filters.q}
          onChange={(event) => setFilters({ ...filters, q: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') applyFilters(filters);
          }}
        />
        <Select
          aria-label="排序方式"
          value={filters.sort}
          onChange={(event) => applyFilters({ ...filters, sort: event.target.value })}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => applyFilters(filters)}
          disabled={loading || busy}
        >
          查询
        </Button>
      </div>

      <div className="admin-table-scroll">
        <Table>
          <THead>
            <Tr>
              <Th>slug</Th>
              <Th>标题</Th>
              <Th>作者</Th>
              <Th>可见性</Th>
              <Th>状态</Th>
              <Th className="admin-table__num">票数</Th>
              <Th>有效期</Th>
              <Th className="admin-table__actions">操作</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <Tr>
                <Td colSpan={8} className="admin-table__empty">
                  {loading ? '加载中…' : '没有符合条件的作品'}
                </Td>
              </Tr>
            ) : (
              rows.map((row) => {
                const expiry = describeExpiry(row.expireAt);
                const blocked = row.status === 'BLOCKED';
                return (
                  <Tr key={row.id} className={cn(blocked && 'admin-table__row--muted')}>
                    <Td>
                      <span className="mono admin-table__slug">{row.slug}</span>
                    </Td>
                    <Td>
                      <span className="admin-table__title" title={row.title}>
                        {row.title}
                      </span>
                    </Td>
                    <Td>
                      <span className="t-body-sm">{row.authorName}</span>
                    </Td>
                    <Td>
                      <Badge tone={visibilityTone(row.visibility)}>{visibilityLabel(row.visibility)}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                    </Td>
                    <Td className="admin-table__num">
                      <span className="mono">{formatCount(row.voteCount)}</span>
                    </Td>
                    <Td>
                      <span className="t-body-sm">{formatDate(row.expireAt)}</span>
                      <Badge tone={expiry.tone === 'archived' ? 'archived' : expiry.tone === 'expiring' ? 'expiring' : 'live'}>
                        {expiry.label}
                      </Badge>
                    </Td>
                    <Td className="admin-table__actions">
                      <div className="admin-row-actions">
                        <Link className="btn btn-sm" href={`/w/${row.slug}/edit`} title="编辑作品信息与截图">
                          编辑
                        </Link>
                        {row.status === 'BLOCKED' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void runBatch('unblock', [row.id])}
                          >
                            恢复
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() =>
                              askConfirm({
                                operation: 'block',
                                ids: [row.id],
                                title: '下架作品',
                                description: `将下架「${row.title}」（${row.slug}），下架后详情页与广场均不可访问。`,
                                danger: true,
                                confirmText: '确认下架',
                              })
                            }
                          >
                            下架
                          </Button>
                        )}
                        {row.status !== 'PURGED' ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                askConfirm({
                                  operation: 'purge',
                                  ids: [row.id],
                                  title: '物理删除作品',
                                  description: `将物理删除「${row.title}」（${row.slug}）的全部文件，且不可恢复。`,
                                  danger: true,
                                  confirmText: '确认删除',
                                })
                              }
                            >
                              删除
                            </Button>
                            <Select
                              className="admin-select-sm"
                              aria-label="续期档位"
                              defaultValue=""
                              disabled={busy}
                              onChange={(event) => {
                                const ttl = Number(event.target.value);
                                if (ttl > 0) handleRenew(row, ttl);
                              }}
                            >
                              <option value="" disabled>
                                续期
                              </option>
                              {TTL_OPTIONS.map((ttl) => (
                                <option key={ttl} value={ttl}>
                                  +{ttl} 天
                                </option>
                              ))}
                            </Select>
                          </>
                        ) : null}
                        <Select
                          className="admin-select-sm"
                          aria-label="修改可见性"
                          value={row.visibility}
                          disabled={busy}
                          onChange={(event) => {
                            const visibility = event.target.value;
                            if (visibility !== row.visibility) {
                              void runBatch('visibility', [row.id], { visibility: visibility as AdminProjectDTO['visibility'] });
                            }
                          }}
                        >
                          {VISIBILITY_OPTIONS.filter((option) => option.value !== '').map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                        <Button
                          size="sm"
                          variant={row.pinned ? 'primary' : 'ghost'}
                          disabled={busy}
                          onClick={() => void runBatch(row.pinned ? 'unpin' : 'pin', [row.id])}
                        >
                          {row.pinned ? '已置顶' : '置顶'}
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })
            )}
          </TBody>
        </Table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onChange={changePage} />

      {confirm ? (
        <ConfirmDialog
          open
          title={confirm.title}
          description={confirm.description}
          danger={confirm.danger}
          confirmText={confirm.confirmText}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void runBatch(confirm.operation, confirm.ids, confirm.payload)}
        />
      ) : null}
    </div>
  );
}
