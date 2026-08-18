'use client';

/**
 * 后台风控面板（P2 风控模块）—— client 组件。
 *
 * 功能：
 *   - 聚合卡片（复用 MetricCard）：可疑分组数 / 可疑票数 / 累计作废票数 / 高危分组数；
 *   - 筛选条：分组维度（IP/设备/用户）+ 活动筛选 + 仅看可疑开关；
 *   - 分组表：key / 票数 / 账号数 / 设备数 / 作品数 / 最高风险 Badge / 已作废 / 最近投票
 *     + 操作（明细 / 作废该组）；
 *   - 明细下钻：RiskVoteDTO 表 + 每行 checkbox 复选 → 「作废选中」；
 *   - 作废确认：ConfirmDialog（additive 扩展的 reason 输入），两种模式文案区分；
 *     成功后 toast「作废 N 票，涉及 M 件作品」+ 本地刷新 + router.refresh()。
 *
 * 数据策略：分组用 `pageSize=100`（ADMIN_MAX_PAGE_SIZE）一次拉全量 → 本地按 20/页
 * 切片（分组数量级小，metrics 需全量才准确）；明细用服务端分页（20/页）。
 */

import * as React from 'react';

import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { MetricCard } from '@/components/admin/MetricCard';
import { Pagination } from '@/components/admin/Pagination';
import { Badge, Button, Card, CardBody, Select, Table, TBody, Td, Th, THead, Tr, useToast } from '@/components/ui';
import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_MAX_PAGE_SIZE,
  RISK_HIGH_THRESHOLD,
  RISK_REASON_MAX_LEN,
  RISK_SUSPICIOUS_THRESHOLD,
} from '@/lib/constants';
import { formatCount, formatDateTime } from '@/lib/format';
import type {
  ApiEnvelope,
  InvalidateResult,
  RiskGroup,
  RiskGroupDTO,
  RiskSummary,
  RiskVoteDTO,
} from '@/lib/types';

/** 组件入参（SSR 首屏数据）。 */
export interface RiskAuditPanelProps {
  initialGroups: RiskGroupDTO[];
  initialSummary: RiskSummary;
  initialTotal: number;
  /** 活动筛选项（id + title，来自 campaignService.list 精简）。 */
  campaigns: Array<{ id: string; title: string }>;
}

/** 确认作废的待处理项。 */
interface PendingInvalidate {
  /** votes = 复选票；scope = 作废整组。 */
  kind: 'votes' | 'scope';
  scopeType?: 'ip' | 'device';
  scopeValue?: string;
  /** 影响票数（确认框说明文案）。 */
  affectedCount: number;
}

/** 明细弹层状态。 */
interface DetailState {
  group: RiskGroup;
  key: string;
  display: string;
  rows: RiskVoteDTO[];
  page: number;
  pageSize: number;
  total: number;
}

/** 风险等级 → Badge tone。 */
function riskTone(level: string): 'live' | 'expiring' | 'blocked' {
  if (level === 'high') return 'blocked';
  if (level === 'suspect') return 'expiring';
  return 'live';
}

/** 风险等级 → 中文文案。 */
function riskLabel(level: string): string {
  if (level === 'high') return '高危';
  if (level === 'suspect') return '可疑';
  return '正常';
}

/** 从分组全量计算聚合卡片指标。 */
function computeSummary(groups: RiskGroupDTO[]): RiskSummary {
  const suspicious = groups.filter((group) => group.maxRiskScore >= RISK_SUSPICIOUS_THRESHOLD);
  return {
    suspiciousGroups: suspicious.length,
    highGroups: groups.filter((group) => group.maxRiskScore >= RISK_HIGH_THRESHOLD).length,
    suspiciousVotes: suspicious.reduce((sum, group) => sum + group.voteCount, 0),
    invalidVotes: groups.reduce((sum, group) => sum + group.invalidCount, 0),
  };
}

/** 渲染风控面板。 */
export function RiskAuditPanel({
  initialGroups,
  initialSummary,
  initialTotal,
  campaigns,
}: RiskAuditPanelProps): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();

  const [group, setGroup] = React.useState<RiskGroup>('ip');
  const [campaignId, setCampaignId] = React.useState<string>('');
  const [suspiciousOnly, setSuspiciousOnly] = React.useState<boolean>(false);

  const [allGroups, setAllGroups] = React.useState<RiskGroupDTO[]>(initialGroups);
  const [summary, setSummary] = React.useState<RiskSummary>(initialSummary);
  const [total, setTotal] = React.useState<number>(initialTotal);
  const [page, setPage] = React.useState<number>(1);
  const [loading, setLoading] = React.useState<boolean>(false);

  const [detail, setDetail] = React.useState<DetailState | null>(null);
  const [detailPage, setDetailPage] = React.useState<number>(1);
  const [detailLoading, setDetailLoading] = React.useState<boolean>(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const [pending, setPending] = React.useState<PendingInvalidate | null>(null);
  const [reason, setReason] = React.useState<string>('');
  const [busy, setBusy] = React.useState<boolean>(false);

  const pageSize = ADMIN_DEFAULT_PAGE_SIZE;

  /** 拉取分组全量（pageSize=100 上限），并本地切片分页。 */
  const loadGroups = React.useCallback(
    async (nextGroup: RiskGroup, nextCampaign: string, nextSuspicious: boolean): Promise<void> => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ group: nextGroup, page: '1', pageSize: String(ADMIN_MAX_PAGE_SIZE) });
        if (nextCampaign) params.set('campaignId', nextCampaign);
        if (nextSuspicious) params.set('suspiciousOnly', '1');
        const res = await fetch(`/api/admin/votes/audit?${params.toString()}`);
        const body = (await res.json()) as ApiEnvelope<RiskGroupDTO[]>;
        if (!body.ok) {
          toast(body.error?.message ?? '加载失败', 'danger');
          return;
        }
        setAllGroups(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        setSummary(computeSummary(body.data));
        setPage(1);
      } catch {
        toast('网络异常，请稍后重试', 'danger');
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  /** 应用筛选。 */
  const applyFilters = (): void => {
    void loadGroups(group, campaignId, suspiciousOnly);
  };

  /** 打开明细（服务端分页）。 */
  const openDetail = async (row: RiskGroupDTO, targetGroup: RiskGroup = group): Promise<void> => {
    setDetailLoading(true);
    setSelected(new Set());
    try {
      const params = new URLSearchParams({ group: targetGroup, key: row.key, page: '1', pageSize: String(pageSize) });
      if (campaignId) params.set('campaignId', campaignId);
      const res = await fetch(`/api/admin/votes/audit/detail?${params.toString()}`);
      const body = (await res.json()) as ApiEnvelope<RiskVoteDTO[]>;
      if (!body.ok) {
        toast(body.error?.message ?? '加载明细失败', 'danger');
        return;
      }
      setDetail({
        group: targetGroup,
        key: row.key,
        display: row.display,
        rows: body.data,
        page: 1,
        pageSize,
        total: body.meta?.total ?? 0,
      });
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setDetailLoading(false);
    }
  };

  /** 明细翻页。 */
  const loadDetailPage = async (nextPage: number): Promise<void> => {
    if (!detail) return;
    setDetailLoading(true);
    try {
      const params = new URLSearchParams({
        group: detail.group,
        key: detail.key,
        page: String(nextPage),
        pageSize: String(detail.pageSize),
      });
      if (campaignId) params.set('campaignId', campaignId);
      const res = await fetch(`/api/admin/votes/audit/detail?${params.toString()}`);
      const body = (await res.json()) as ApiEnvelope<RiskVoteDTO[]>;
      if (!body.ok) {
        toast(body.error?.message ?? '加载明细失败', 'danger');
        return;
      }
      setDetail({ ...detail, rows: body.data, page: body.meta?.page ?? nextPage, total: body.meta?.total ?? detail.total });
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setDetailLoading(false);
    }
  };

  /** 切换复选。 */
  const toggleSelect = (voteId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(voteId)) next.delete(voteId);
      else next.add(voteId);
      return next;
    });
  };

  /** 发起作废请求。 */
  const confirmInvalidate = async (): Promise<void> => {
    if (!pending || busy) return;
    if (reason.trim() === '') {
      toast('请填写作废原因', 'danger');
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { reason: reason.trim() };
      if (pending.kind === 'votes') {
        payload.voteIds = [...selected];
      } else {
        payload.scope = { type: pending.scopeType, value: pending.scopeValue };
        if (campaignId) payload.campaignId = campaignId;
      }
      const res = await fetch('/api/admin/votes/invalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as ApiEnvelope<InvalidateResult>;
      if (!body.ok) {
        toast(body.error?.message ?? '作废失败', 'danger');
        return;
      }
      const data = body.data;
      toast(`作废 ${data.invalidated} 票，涉及 ${data.affectedProjects.length} 件作品`, 'success');
      setPending(null);
      setReason('');
      setSelected(new Set());
      // 本地刷新分组/明细 + 服务端重渲（榜单/详情页同步）
      await loadGroups(group, campaignId, suspiciousOnly);
      if (detail) {
        await openDetail({ key: detail.key, display: detail.display } as RiskGroupDTO, detail.group);
      }
      router.refresh();
    } catch {
      toast('网络异常，请稍后重试', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const displayGroups = allGroups.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="admin-stack">
      {/* 聚合卡片 */}
      <div className="admin-metrics">
        <MetricCard label="可疑分组数" value={formatCount(summary.suspiciousGroups)} hint={`riskScore ≥ ${RISK_SUSPICIOUS_THRESHOLD}`} />
        <MetricCard label="可疑票数" value={formatCount(summary.suspiciousVotes)} hint="可疑分组内累计" />
        <MetricCard label="累计作废票数" value={formatCount(summary.invalidVotes)} hint="valid=false" />
        <MetricCard label="高危分组数" value={formatCount(summary.highGroups)} hint={`riskScore ≥ ${RISK_HIGH_THRESHOLD}`} />
      </div>

      <Card className="admin-card">
        <CardBody>
          <div className="risk-filters">
            <Select
              className="admin-select-sm"
              aria-label="分组维度"
              value={group}
              onChange={(event) => setGroup(event.target.value as RiskGroup)}
            >
              <option value="ip">按 IP</option>
              <option value="device">按设备</option>
              <option value="user">按用户</option>
            </Select>

            <Select
              className="admin-select-sm"
              aria-label="活动筛选"
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
            >
              <option value="">全部活动</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.title}
                </option>
              ))}
            </Select>

            <label className="risk-check-label" aria-label="仅看可疑">
              <input
                type="checkbox"
                className="risk-check"
                checked={suspiciousOnly}
                onChange={(event) => setSuspiciousOnly(event.target.checked)}
              />
              仅看可疑
            </label>

            <Button size="sm" variant="secondary" onClick={applyFilters} disabled={loading}>
              {loading ? '查询中…' : '查询'}
            </Button>
          </div>

          <div className="admin-table-scroll">
            <Table>
              <THead>
                <Tr>
                  <Th>分组键</Th>
                  <Th className="admin-table__num">票数</Th>
                  <Th className="admin-table__num">账号数</Th>
                  <Th className="admin-table__num">设备数</Th>
                  <Th className="admin-table__num">作品数</Th>
                  <Th>最高风险</Th>
                  <Th className="admin-table__num">已作废</Th>
                  <Th>最近投票</Th>
                  <Th className="admin-table__actions">操作</Th>
                </Tr>
              </THead>
              <TBody>
                {displayGroups.length === 0 ? (
                  <Tr>
                    <Td colSpan={9} className="admin-table__empty">
                      {loading ? '加载中…' : '暂无分组数据'}
                    </Td>
                  </Tr>
                ) : (
                  displayGroups.map((row) => (
                    <Tr key={`${group}:${row.key}`}>
                      <Td>
                        <span className="risk-key mono" title={row.key}>
                          {row.display}
                        </span>
                      </Td>
                      <Td className="admin-table__num">
                        <span className="mono">{formatCount(row.voteCount)}</span>
                      </Td>
                      <Td className="admin-table__num">
                        <span className="mono">{formatCount(row.accountCount)}</span>
                      </Td>
                      <Td className="admin-table__num">
                        <span className="mono">{formatCount(row.deviceCount)}</span>
                      </Td>
                      <Td className="admin-table__num">
                        <span className="mono">{formatCount(row.projectCount)}</span>
                      </Td>
                      <Td>
                        <Badge tone={riskTone(row.riskLevel)}>{riskLabel(row.riskLevel)}</Badge>
                        <span className="risk-score" data-level={row.riskLevel}>
                          {' '}
                          {formatCount(row.maxRiskScore)}
                        </span>
                      </Td>
                      <Td className="admin-table__num">
                        <span className="mono">{formatCount(row.invalidCount)}</span>
                      </Td>
                      <Td>
                        <span className="t-body-sm">{formatDateTime(row.latestAt)}</span>
                      </Td>
                      <Td className="admin-table__actions">
                        <div className="admin-row-actions">
                          <Button size="sm" variant="secondary" onClick={() => void openDetail(row)}>
                            明细
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={group === 'user'}
                            title={group === 'user' ? '用户维度不支持整组作废，请在明细中勾选票' : undefined}
                            onClick={() =>
                              setPending({
                                kind: 'scope',
                                scopeType: group === 'device' ? 'device' : 'ip',
                                scopeValue: row.key,
                                affectedCount: row.validCount,
                              })
                            }
                          >
                            作废该组
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </div>

          <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
        </CardBody>
      </Card>

      {/* 明细弹层 */}
      {detail ? (
        <div className="risk-detail" role="dialog" aria-modal="true" aria-label="可疑票明细">
          <Card className="admin-card">
            <CardBody>
              <div className="risk-detail-head">
                <div>
                  <h2 className="t-card-title">
                    明细 · <span className="mono">{detail.display}</span>
                  </h2>
                  <p className="t-body-sm muted" style={{ marginTop: 4 }}>
                    共 {detail.total} 票 · 勾选后点击「作废选中票」
                  </p>
                </div>
                <div className="admin-row-actions">
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={selected.size === 0}
                    onClick={() => setPending({ kind: 'votes', affectedCount: selected.size })}
                  >
                    作废选中票（{selected.size}）
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDetail(null)}>
                    关闭
                  </Button>
                </div>
              </div>

              <div className="admin-table-scroll">
                <Table>
                  <THead>
                    <Tr>
                      <Th>
                        <span className="sr-only">选择</span>
                      </Th>
                      <Th>作品</Th>
                      <Th>用户</Th>
                      <Th className="admin-table__num">风险分</Th>
                      <Th className="admin-table__num">停留 ms</Th>
                      <Th>状态</Th>
                      <Th>时间</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {detail.rows.length === 0 ? (
                      <Tr>
                        <Td colSpan={7} className="admin-table__empty">
                          {detailLoading ? '加载中…' : '该分组暂无票'}
                        </Td>
                      </Tr>
                    ) : (
                      detail.rows.map((vote) => (
                        <Tr key={vote.id} className={!vote.valid ? 'admin-table__row--muted' : undefined}>
                          <Td>
                            <input
                              type="checkbox"
                              className="risk-check"
                              checked={selected.has(vote.id)}
                              onChange={() => toggleSelect(vote.id)}
                              aria-label={`选择 ${vote.title} 的投票`}
                            />
                          </Td>
                          <Td>
                            <div className="admin-table__title" title={vote.title}>
                              {vote.title}
                            </div>
                            <div className="mono admin-table__slug">{vote.slug}</div>
                          </Td>
                          <Td>
                            <span className="t-body-sm">{vote.nickname}</span>
                          </Td>
                          <Td className="admin-table__num">
                            <span
                              className="risk-score"
                              data-level={vote.riskScore >= RISK_HIGH_THRESHOLD ? 'high' : vote.riskScore >= RISK_SUSPICIOUS_THRESHOLD ? 'suspect' : 'normal'}
                            >
                              {formatCount(vote.riskScore)}
                            </span>
                          </Td>
                          <Td className="admin-table__num">
                            <span className="mono">{vote.dwellMs != null ? formatCount(vote.dwellMs) : '—'}</span>
                          </Td>
                          <Td>
                            {vote.valid ? (
                              <Badge tone="live">有效</Badge>
                            ) : (
                              <Badge tone="blocked" dot>
                                已作废
                              </Badge>
                            )}
                          </Td>
                          <Td>
                            <span className="t-body-sm">{formatDateTime(vote.createdAt)}</span>
                          </Td>
                        </Tr>
                      ))
                    )}
                  </TBody>
                </Table>
              </div>

              <Pagination page={detail.page} pageSize={detail.pageSize} total={detail.total} onChange={loadDetailPage} />
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* 作废确认（reason 必填） */}
      {pending ? (
        <ConfirmDialog
          open
          title={pending.kind === 'votes' ? '作废选中票' : '作废该组全部有效票'}
          description={
            pending.kind === 'votes'
              ? `将作废已勾选的 ${pending.affectedCount} 票：作废后该作品票数/榜单自动回落，quota 退回；同一作品不可再投。`
              : `将作废该${pending.scopeType === 'device' ? '设备' : 'IP'}下 ${pending.affectedCount} 张有效票（${pending.scopeValue}）${campaignId ? '，仅限当前选中的活动' : '，不区分活动'}；作废后榜单自动重算。`
          }
          danger
          confirmText="确认作废"
          busy={busy}
          reason={reason}
          onReasonChange={setReason}
          onCancel={() => {
            setPending(null);
            setReason('');
          }}
          onConfirm={() => void confirmInvalidate()}
        />
      ) : null}
    </div>
  );
}
