/**
 * 概览页（P3.5）—— Server Component。
 *
 * 设计真源：docs/P3-我的后台设计.md §1.4；视觉基准：prototype #view-dashboard（1666-1718 行）。
 * - 欢迎头：Avatar + 「你好，{昵称}」+ 角色徽章（brand-gradient）+ 副文案；
 * - 4 个 KPI（复用 .kpis/.kpi）：我的作品 / 累计票数 / 总浏览 / 参与活动数（Q8 纯展示不点击）；
 * - 存储空间面板：SUM(sizeBytes) / STORAGE_QUOTA_BYTES(5GB) + 进度条（percent 封顶 100）+ 超限文案；
 * - 最近作品表格：最近 5 条（作品/状态/票数/浏览/操作，操作复用 ProjectActions，Q7）。
 */

import Link from 'next/link';

import { Avatar, Badge, EmptyState } from '@/components/ui';
import { ProjectActions } from '@/components/project';
import {
  PROJECT_STATUS,
  STORAGE_QUOTA_BYTES,
  roleLabel,
  type ProjectStatus,
  type Visibility,
} from '@/lib/constants';
import { formatBytes, formatCount } from '@/lib/format';
import type { MyProjectStats, ProjectDTO } from '@/lib/types';

/** 组件属性。 */
export interface OverviewPanelProps {
  /** 计数聚合（含 storageBytes）。 */
  stats: MyProjectStats;
  /** 参与活动数（去重活动数，Q8 纯展示）。 */
  joinedCount: number;
  /** 最近作品（列表已按 createdAt desc，由 page 取前 5 条）。 */
  recentProjects: ProjectDTO[];
  /** 昵称（欢迎头展示）。 */
  nickname: string;
  /** 角色（USER/JUDGE/ADMIN/SUPER_ADMIN，欢迎头徽章）。 */
  role: string;
}

/** 作品状态 → 徽章语气 + 文案（与 MyProjectsPanel 同规则，PURGED/BLOCKED 不产生死链）。 */
function statusBadge(status: ProjectStatus): { tone: 'live' | 'archived' | 'private' | 'blocked'; label: string } {
  switch (status) {
    case PROJECT_STATUS.ACTIVE:
      return { tone: 'live', label: '在线' };
    case PROJECT_STATUS.ARCHIVED:
      return { tone: 'archived', label: '已归档' };
    case PROJECT_STATUS.PURGED:
      return { tone: 'private', label: '已清除' };
    case PROJECT_STATUS.BLOCKED:
      return { tone: 'blocked', label: '已屏蔽' };
    default:
      return { tone: 'private', label: status };
  }
}

/** 渲染概览页。 */
export function OverviewPanel({
  stats,
  joinedCount,
  recentProjects,
  nickname,
  role,
}: OverviewPanelProps): React.JSX.Element {
  // 存储面板口径（§1.4）：已用 = SUM(sizeBytes)（PURGED 已归 0 = 磁盘占用）；percent 封顶 100
  const usedBytes = stats.storageBytes;
  const quotaBytes = STORAGE_QUOTA_BYTES;
  const percent = Math.min(100, quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0);
  const overQuota = usedBytes > quotaBytes;

  return (
    <div>
      {/* 欢迎头 */}
      <div className="user-head">
        <Avatar name={nickname} />
        <div>
          <h1 className="t-title" style={{ margin: 0 }}>
            你好，{nickname}
            <Badge className="role-badge" tone="campaign">
              {roleLabel(role)}
            </Badge>
          </h1>
          <p className="t-body-sm muted" style={{ marginTop: 3 }}>
            这是你的个人工作台 · 管理作品、查看投票、参与活动
          </p>
        </div>
      </div>

      {/* 4 个 KPI（纯展示，不点击，Q8） */}
      <div className="kpis" aria-label="我的数据概览">
        <div className="kpi">
          <div className="kpi__head">
            <span className="t-overline muted">我的作品</span>
            <span className="kpi__ico" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18" />
              </svg>
            </span>
          </div>
          <div className="kpi__num">{formatCount(stats.projectCount)}</div>
          <div className="kpi__foot">含回收站与已清除作品</div>
        </div>

        <div className="kpi">
          <div className="kpi__head">
            <span className="t-overline muted">累计票数</span>
            <span className="kpi__ico" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.5 12 20 12 20Z" />
              </svg>
            </span>
          </div>
          <div className="kpi__num">{formatCount(stats.voteCount)}</div>
          <div className="kpi__foot">我全部作品收到的票</div>
        </div>

        <div className="kpi">
          <div className="kpi__head">
            <span className="t-overline muted">总浏览</span>
            <span className="kpi__ico" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="2.6" />
              </svg>
            </span>
          </div>
          <div className="kpi__num">{formatCount(stats.viewCount)}</div>
          <div className="kpi__foot">我全部作品的浏览总和</div>
        </div>

        <div className="kpi">
          <div className="kpi__head">
            <span className="t-overline muted">参与活动</span>
            <span className="kpi__ico" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M8 21h8M12 17v4" />
                <path d="M17 3H7v6a5 5 0 0 0 10 0V3Z" />
              </svg>
            </span>
          </div>
          <div className="kpi__num">{formatCount(joinedCount)}</div>
          <div className="kpi__foot">我报名的活动数</div>
        </div>
      </div>

      {/* 存储空间配额（纯展示，Q4：不拦截发布） */}
      <div className="panel storage-panel">
        <div className="panel__head">
          <h3>存储空间</h3>
          <div className="nav__spacer" />
          <Badge tone="private">免费版 {formatBytes(quotaBytes)}</Badge>
        </div>
        <div className="panel__body">
          <div className="storage-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="存储空间使用率">
            <i style={{ width: `${percent}%` }} />
          </div>
          <div className="storage-meta">
            <span>
              已用 <b className="mono">{formatBytes(usedBytes)}</b> / 配额 <b className="mono">{formatBytes(quotaBytes)}</b>
            </span>
            <span className="mono">{percent}%</span>
          </div>
          <p
            className="t-body-sm"
            style={{ marginTop: 12, color: overQuota ? 'var(--color-danger)' : 'var(--text-tertiary)' }}
          >
            {overQuota
              ? '已超出存储配额，将无法发布新作品。删除陈旧作品可释放空间。'
              : '超出配额将无法发布新作品。删除陈旧作品可释放空间。'}
          </p>
        </div>
      </div>

      {/* 最近作品（最近 5 条） */}
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel__head">
          <h3>最近作品</h3>
          <div className="nav__spacer" />
          <Link className="btn btn-ghost btn-sm" href="/dashboard?page=myprojects">
            查看全部
          </Link>
        </div>
        {recentProjects.length === 0 ? (
          <div className="panel__body">
            <EmptyState
              title="你还没有作品"
              desc="发布你的第一个作品，一分钟拿到可分享的短链。"
              action={
                <Link className="btn btn-primary" href="/new">
                  发布作品
                </Link>
              }
            />
          </div>
        ) : (
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead className="admin-table__head">
                <tr>
                  <th>作品</th>
                  <th>状态</th>
                  <th className="admin-table__num">票数</th>
                  <th className="admin-table__num">浏览</th>
                  <th className="admin-table__actions" style={{ textAlign: 'right' }}>
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="admin-table__body">
                {recentProjects.map((project) => {
                  const noAction =
                    project.status === PROJECT_STATUS.PURGED || project.status === PROJECT_STATUS.BLOCKED;
                  const badge = statusBadge(project.status as ProjectStatus);
                  return (
                    <tr
                      key={project.id}
                      className={noAction ? 'admin-table__row admin-table__row--muted' : 'admin-table__row'}
                    >
                      <td>
                        {noAction ? (
                          <span className="admin-table__title" title={project.title}>
                            {project.title}
                          </span>
                        ) : (
                          <Link className="admin-table__title" href={`/w/${project.slug}`} title={project.title}>
                            {project.title}
                          </Link>
                        )}
                        <div className="admin-table__slug mono">{project.slug}</div>
                      </td>
                      <td>
                        <Badge tone={badge.tone} dot={project.status === PROJECT_STATUS.ACTIVE}>
                          {badge.label}
                        </Badge>
                      </td>
                      <td className="admin-table__num">{formatCount(project.voteCount)}</td>
                      <td className="admin-table__num">{formatCount(project.viewCount)}</td>
                      <td className="admin-table__actions">
                        {noAction ? (
                          <span className="t-caption muted">—</span>
                        ) : (
                          <ProjectActions
                            slug={project.slug}
                            ttlDays={project.ttlDays}
                            archived={project.status === PROJECT_STATUS.ARCHIVED}
                            canManage
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
