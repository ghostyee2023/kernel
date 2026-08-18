/**
 * 作品状态页 `/_status/{slug}`。
 *
 * 沙箱访问归档作品时的友好落地页 —— 与其甩一个冷冰冰的 410，
 * 不如告诉用户「还剩几天可恢复」并给一键续期。
 *
 * 三种状态：
 *   ARCHIVED  回收站中，展示倒计时 + 恢复按钮
 *   PURGED    已永久删除，只能展示墓碑
 *   ACTIVE    其实还活着（用户手输了地址），直接跳详情页
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ProjectActions } from '@/components/project';
import { Badge, SideCard } from '@/components/ui';
import { getSession, isAdminRole } from '@/lib/auth';
import { PROJECT_STATUS, RECYCLE_BIN_DAYS } from '@/lib/constants';
import { daysUntil, formatDateTime } from '@/lib/format';
import * as projectService from '@/lib/project-service';

export const dynamic = 'force-dynamic';

/** 页面参数。 */
type PageProps = { params: Promise<{ slug: string }> };

export const metadata: Metadata = {
  title: '作品状态 — Kernel 创意种子',
  robots: { index: false, follow: false },
};

export default async function ProjectStatusPage({ params }: PageProps) {
  const { slug } = await params;
  const project = await projectService.peek(slug);

  if (!project) notFound();

  if (project.status === PROJECT_STATUS.ACTIVE) {
    redirect(`/w/${slug}`);
  }

  // 管理权限：作者本人或管理员（docs/03 §3.1：作者 or 管理员）
  const session = await getSession();
  const canManage = isAdminRole(session?.role) || project.authorId === session?.userId;

  const purged = project.status === PROJECT_STATUS.PURGED;
  const daysLeft = project.purgeAt ? Math.max(0, daysUntil(project.purgeAt)) : 0;

  return (
    <div className="container-prose status">
      <div className="status__card">
        <div className="status__icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="56" height="56">
            <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path
              d="M24 13v12l8 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <Badge tone="archived" dot>
          {purged ? '已永久删除' : '已归档'}
        </Badge>

        <h1 className="status__title">{project.title}</h1>

        {purged ? (
          <p className="status__desc">
            这件作品已超过 {RECYCLE_BIN_DAYS} 天回收期，文件已被永久清除，无法恢复。
            <br />
            短码 <code>{project.slug}</code> 仍被占用，不会被其它作品复用。
          </p>
        ) : (
          <p className="status__desc">
            这件作品的有效期已到，目前在回收站中，暂时无法访问。
            <br />
            还剩 <strong>{daysLeft}</strong> 天可以一键恢复，
            {project.purgeAt ? `逾期（${formatDateTime(project.purgeAt)}）将被永久删除。` : '逾期将被永久删除。'}
          </p>
        )}

        {!purged && canManage ? (
          <div className="status__actions">
            <ProjectActions slug={slug} ttlDays={project.ttlDays} archived canManage />
          </div>
        ) : null}

        <div className="status__links">
          <Link className="btn btn-ghost" href="/">
            回到作品广场
          </Link>
          <Link className="btn btn-secondary" href="/new">
            发布新作品
          </Link>
        </div>
      </div>

      <SideCard className="status__meta">
        <h3 className="side-card__title">为什么会这样？</h3>
        <p className="status__note">
          Kernel 上的每件作品都有明确的有效期。到期后先进入回收站（{RECYCLE_BIN_DAYS} 天），
          期间随时可以续期复活；超期才会真正删除文件。
        </p>
        <p className="status__note">
          这样既能让平台的存储成本可控，也保证不会有作品「悄无声息地消失」。
        </p>
      </SideCard>
    </div>
  );
}
