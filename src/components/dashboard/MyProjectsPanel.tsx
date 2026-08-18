/**
 * 我发布的（P3.5 我的作品页，迁移自 P3 Tab 1）—— Server Component。
 *
 * - Panel head 右侧加「＋ 新作品」按钮 → /new（对齐原型 1730 行）；
 * - 表格本体迁移不动：SSR initialRows → `.admin-table` 表格（复用后台表格样式 + 操作列
 *   ProjectActions，Q5）。PURGED / BLOCKED 行只展示状态徽章、不渲染操作、标题不加链接
 *   （避免死链/管理动作报错）。ACTIVE / ARCHIVED 可进详情与续期/删除。
 */

import Link from 'next/link';

import { Badge, EmptyState } from '@/components/ui';
import { ProjectActions } from '@/components/project';
import {
  PROJECT_STATUS,
  VISIBILITY,
  type ProjectStatus,
  type Visibility,
} from '@/lib/constants';
import { formatCount, formatDate } from '@/lib/format';
import type { ProjectDTO } from '@/lib/types';

/** 组件属性。 */
export interface MyProjectsPanelProps {
  initialRows: ProjectDTO[];
}

/** 作品状态 → 徽章语气 + 文案。 */
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

/** 可见性 → 中文文案。 */
function visibilityLabel(visibility: Visibility): string {
  switch (visibility) {
    case VISIBILITY.PUBLIC:
      return '公开';
    case VISIBILITY.UNLISTED:
      return '不公开';
    case VISIBILITY.PRIVATE:
      return '私密';
    default:
      return visibility;
  }
}

/** 渲染我发布的表格或空态（Panel head 常驻「＋ 新作品」按钮）。 */
export function MyProjectsPanel({ initialRows }: MyProjectsPanelProps): React.JSX.Element {
  return (
    <div>
      <div className="dash-page-head">
        <h1 className="t-title" style={{ margin: 0 }}>
          我的作品
        </h1>
        <p className="t-body-sm muted" style={{ marginTop: 3 }}>
          管理你上传的作品：可见性、活动关联、有效期与分享
        </p>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h3>
            全部作品 <Badge tone="private">含私密</Badge>
          </h3>
          <div className="nav__spacer" />
          <Link className="btn btn-secondary btn-sm" href="/new">
            ＋ 新作品
          </Link>
        </div>

        {initialRows.length === 0 ? (
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
                  <th>可见性</th>
                  <th className="admin-table__num">票数</th>
                  <th className="admin-table__num">浏览</th>
                  <th>有效期</th>
                  <th className="admin-table__actions" style={{ textAlign: 'right' }}>
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="admin-table__body">
                {initialRows.map((project) => {
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
                      <td>
                        <Badge tone={project.visibility === VISIBILITY.PUBLIC ? 'live' : 'unlisted'}>
                          {visibilityLabel(project.visibility as Visibility)}
                        </Badge>
                      </td>
                      <td className="admin-table__num">{formatCount(project.voteCount)}</td>
                      <td className="admin-table__num">{formatCount(project.viewCount)}</td>
                      <td className="mono">{formatDate(project.expireAt)}</td>
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
