'use client';

/**
 * 后台用户管理表格（P2）—— client 组件。
 *
 * 封禁 / 解封走 `POST /api/admin/users/:id/ban`（Q6：禁封 ADMIN/SUPER_ADMIN 与自身，
 * 服务端抛 FORBIDDEN；前端同时对 ADMIN/自身禁用按钮）。BANNED 行整行降透明度。
 */

import * as React from 'react';

import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Pagination } from '@/components/admin/Pagination';
import { Badge, Button, Input, Select, Table, TBody, Td, Th, THead, Tr, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDate, formatCount } from '@/lib/format';
import type { AdminUserDTO } from '@/lib/types';

/** 角色选项。 */
const ROLE_OPTIONS = [
  { value: '', label: '全部角色' },
  { value: 'USER', label: '普通用户' },
  { value: 'JUDGE', label: '评委' },
  { value: 'ADMIN', label: '管理员' },
  { value: 'SUPER_ADMIN', label: '超级管理员' },
] as const;

/** 状态选项。 */
const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'ACTIVE', label: '正常' },
  { value: 'BANNED', label: '已封禁' },
] as const;

/** 二次确认状态。 */
interface ConfirmState {
  id: string;
  action: 'ban' | 'unban';
  nickname: string;
}

/** 组件入参。 */
export interface UsersTableProps {
  initialRows: AdminUserDTO[];
  initialPage: number;
  initialPageSize: number;
  initialTotal: number;
  /** 当前管理员用户 id（用于禁用「封禁自己」）。 */
  currentUserId: string;
}

/** 角色中文文案。 */
function roleLabel(role: string): string {
  const map: Record<string, string> = {
    USER: '普通用户',
    JUDGE: '评委',
    ADMIN: '管理员',
    SUPER_ADMIN: '超级管理员',
  };
  return map[role] ?? role;
}

/** 角色 → Badge tone。 */
function roleTone(role: string): 'campaign' | 'live' | 'expiring' {
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return 'campaign';
  if (role === 'JUDGE') return 'live';
  return 'expiring';
}

/** 用户管理表格。 */
export function UsersTable({
  initialRows,
  initialPage,
  initialPageSize,
  initialTotal,
  currentUserId,
}: UsersTableProps): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();

  const [filters, setFilters] = React.useState({ q: '', role: '', status: '' });
  const [page, setPage] = React.useState<number>(initialPage);
  const [pageSize] = React.useState<number>(initialPageSize);
  const [rows, setRows] = React.useState<AdminUserDTO[]>(initialRows);
  const [total, setTotal] = React.useState<number>(initialTotal);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [busy, setBusy] = React.useState<boolean>(false);
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null);

  /** 按条件拉取一页用户。 */
  const load = React.useCallback(
    async (nextPage: number, nextFilters: typeof filters): Promise<void> => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (nextFilters.q.trim()) params.set('q', nextFilters.q.trim());
        if (nextFilters.role) params.set('role', nextFilters.role);
        if (nextFilters.status) params.set('status', nextFilters.status);
        params.set('page', String(nextPage));
        params.set('pageSize', String(pageSize));

        const res = await fetch(`/api/admin/users?${params.toString()}`);
        const body = await res.json();
        if (!body.ok) {
          toast(body.error?.message ?? '加载失败', 'danger');
          return;
        }
        setRows(body.data as AdminUserDTO[]);
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

  const applyFilters = (next: typeof filters): void => {
    setFilters(next);
    void load(1, next);
  };

  const changePage = (nextPage: number): void => {
    void load(nextPage, filters);
  };

  /** 执行封禁 / 解封。 */
  const runBan = async (state: ConfirmState): Promise<void> => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${state.id}/ban`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: state.action }),
      });
      const body = await res.json();
      if (!body.ok) {
        toast(body.error?.message ?? '操作失败', 'danger');
        return;
      }
      toast(state.action === 'ban' ? `已封禁 ${state.nickname}` : `已解封 ${state.nickname}`, 'success');
      void load(page, filters);
      router.refresh();
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="admin-table-wrap">
      <div className="admin-filter-bar">
        <Input
          className="admin-filter-bar__q"
          placeholder="搜索用户名 / 昵称"
          value={filters.q}
          onChange={(event) => setFilters({ ...filters, q: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') applyFilters(filters);
          }}
        />
        <Select
          aria-label="按角色筛选"
          value={filters.role}
          onChange={(event) => applyFilters({ ...filters, role: event.target.value })}
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
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
        <Button size="sm" variant="secondary" onClick={() => applyFilters(filters)} disabled={loading || busy}>
          查询
        </Button>
      </div>

      <div className="admin-table-scroll">
        <Table>
          <THead>
            <Tr>
              <Th>用户名</Th>
              <Th>昵称</Th>
              <Th>角色</Th>
              <Th>状态</Th>
              <Th className="admin-table__num">作品数</Th>
              <Th>注册时间</Th>
              <Th className="admin-table__actions">操作</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <Tr>
                <Td colSpan={7} className="admin-table__empty">
                  {loading ? '加载中…' : '没有符合条件的用户'}
                </Td>
              </Tr>
            ) : (
              rows.map((row) => {
                const banned = row.status === 'BANNED';
                const isAdmin = row.role === 'ADMIN' || row.role === 'SUPER_ADMIN';
                const isSelf = row.id === currentUserId;
                const banDisabled = busy || isAdmin || isSelf;
                return (
                  <Tr key={row.id} className={cn(banned && 'admin-table__row--muted')}>
                    <Td>
                      <span className="mono">{row.username ?? '—'}</span>
                    </Td>
                    <Td>
                      <span className="t-body-sm">{row.nickname}</span>
                    </Td>
                    <Td>
                      <Badge tone={roleTone(row.role)}>{roleLabel(row.role)}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={banned ? 'blocked' : 'live'}>{banned ? '已封禁' : '正常'}</Badge>
                    </Td>
                    <Td className="admin-table__num">
                      <span className="mono">{formatCount(row.projectCount)}</span>
                    </Td>
                    <Td>
                      <span className="t-body-sm">{formatDate(row.createdAt)}</span>
                    </Td>
                    <Td className="admin-table__actions">
                      <div className="admin-row-actions">
                        {banned ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => setConfirm({ id: row.id, action: 'unban', nickname: row.nickname })}
                          >
                            解封
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={banDisabled}
                            title={
                              isAdmin
                                ? '管理员账号不可被封禁'
                                : isSelf
                                  ? '不能封禁自己'
                                  : undefined
                            }
                            onClick={() => setConfirm({ id: row.id, action: 'ban', nickname: row.nickname })}
                          >
                            封禁
                          </Button>
                        )}
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
          title={confirm.action === 'ban' ? '封禁用户' : '解封用户'}
          description={
            confirm.action === 'ban'
              ? `将封禁「${confirm.nickname}」，封禁后该用户无法再登录（已有会话可能延迟失效）。`
              : `将解封「${confirm.nickname}」，恢复登录权限。`
          }
          danger={confirm.action === 'ban'}
          confirmText={confirm.action === 'ban' ? '确认封禁' : '确认解封'}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void runBan(confirm)}
        />
      ) : null}
    </div>
  );
}
