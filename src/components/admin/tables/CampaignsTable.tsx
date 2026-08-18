'use client';

/**
 * 后台活动管理表格（P1 活动模块）—— 列表展示 + 分页。
 *
 * 数据流：RSC 首屏 `initialRows` → 直接渲染；分页用 Link 写回
 * `/admin/campaigns?page=N`（服务端 force-dynamic 重渲，无需额外列表 API）。
 * 操作（编辑 / 新建）均为站内链接；移除报名在编辑页承载。
 */

import * as React from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Pagination } from '@/components/admin/Pagination';
import { campaignStatusLabel, campaignStatusTone } from '@/components/campaign/CampaignCard';
import { Badge, Button, Table, TBody, Td, Th, THead, Tr } from '@/components/ui';
import { formatCount, formatDate } from '@/lib/format';
import type { CampaignCardDTO } from '@/lib/types';

/** 组件入参（SSR 首屏数据）。 */
export interface CampaignsTableProps {
  initialRows: CampaignCardDTO[];
  initialPage: number;
  initialPageSize: number;
  initialTotal: number;
}

/** 后台活动管理表格。 */
export function CampaignsTable({
  initialRows,
  initialPage,
  initialPageSize,
  initialTotal,
}: CampaignsTableProps): React.JSX.Element {
  const router = useRouter();

  /** 翻页：写回 `/admin/campaigns?page=N`（服务端 force-dynamic 重渲）。 */
  const changePage = (nextPage: number): void => {
    router.push(nextPage > 1 ? `/admin/campaigns?page=${nextPage}` : '/admin/campaigns');
  };
  return (
    <div className="admin-table-wrap">
      <div className="admin-table-scroll">
        <Table>
          <THead>
            <Tr>
              <Th>活动</Th>
              <Th>状态</Th>
              <Th className="admin-table__num">作品数</Th>
              <Th className="admin-table__num">票数</Th>
              <Th>投票规则</Th>
              <Th>周期</Th>
              <Th className="admin-table__actions">操作</Th>
            </Tr>
          </THead>
          <TBody>
            {initialRows.length === 0 ? (
              <Tr>
                <Td colSpan={7} className="admin-table__empty">
                  还没有活动，点击右上角「新建活动」开始。
                </Td>
              </Tr>
            ) : (
              initialRows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <div className="admin-table__title" title={row.title}>
                      {row.title}
                    </div>
                    <div className="mono admin-table__slug">{row.slug}</div>
                  </Td>
                  <Td>
                    <Badge tone={campaignStatusTone(row.status)}>{campaignStatusLabel(row.status)}</Badge>
                  </Td>
                  <Td className="admin-table__num">
                    <span className="mono">{formatCount(row.projectCount)}</span>
                  </Td>
                  <Td className="admin-table__num">
                    <span className="mono">{formatCount(row.voteCount)}</span>
                  </Td>
                  <Td>
                    <span className="t-body-sm">
                      每人 {row.maxVotesPerUser} 票 · {row.allowSelfVote ? '可自投' : '禁自投'}
                    </span>
                  </Td>
                  <Td>
                    <span className="t-body-sm">{formatDate(row.collectEndAt)} → {formatDate(row.voteEndAt)}</span>
                  </Td>
                  <Td className="admin-table__actions">
                    <Link href={`/admin/campaigns/${row.id}/edit`}>
                      <Button size="sm" variant="secondary">
                        编辑
                      </Button>
                    </Link>
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </div>

      <Pagination page={initialPage} pageSize={initialPageSize} total={initialTotal} onChange={changePage} />
    </div>
  );
}
