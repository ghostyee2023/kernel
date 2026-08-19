/**
 * 编辑作品页 `/w/{slug}/edit`。
 *
 * 鉴权（与 PATCH API 同源）：
 *   1. 未登录 → 跳登录（登录后回到本页）；
 *   2. 作品不存在 / 已 PURGED → 404 提示；
 *   3. 非作者且非管理员 → 无权限提示（不泄漏作品内容）。
 * 作者可编辑自己的 PRIVATE / ARCHIVED 作品（getBySlug 放行两项）。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { EditProjectForm } from '@/components/project/EditProjectForm';
import { canManageProject, getSession } from '@/lib/auth';
import { getBySlug } from '@/lib/project-service';
import { AppError, ERROR_CODE } from '@/lib/response';

export const metadata: Metadata = {
  title: '编辑作品',
  description: '修改作品标题、介绍与截图。',
};

/** 参数类型（Next 15 动态参数为 Promise）。 */
type Params = Promise<{ slug: string }>;

/** 通用提示卡。 */
function NoticeCard({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <div className="container-prose publish-page">
      <header className="publish-page__head">
        <h1 className="t-display-lg">{title}</h1>
        <p className="muted">{body}</p>
        <Link className="btn btn-primary" href={href}>
          {cta}
        </Link>
      </header>
    </div>
  );
}

export default async function EditProjectPage({ params }: { params: Params }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/w/${encodeURIComponent(slug)}/edit`);

  let project;
  try {
    // 作者编辑自己的私密 / 归档作品时需要放行这两项
    project = await getBySlug(slug, { allowPrivate: true, allowArchived: true });
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODE.NOT_FOUND) {
      return <NoticeCard title="作品不存在" body="它可能已被下线或彻底删除。" href="/" cta="返回作品广场" />;
    }
    throw error;
  }

  if (!canManageProject(session, project)) {
    return <NoticeCard title="无权编辑" body="只有作品作者或管理员可以编辑。" href={`/w/${slug}`} cta="返回作品页" />;
  }

  return <EditProjectForm project={project} />;
}
