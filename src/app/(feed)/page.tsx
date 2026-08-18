/**
 * 作品广场（首页）。
 *
 * Server Component 直接查领域服务：首屏即完整 HTML，无客户端瀑布请求。
 * 搜索与翻页状态全部放在 URL 上，`<Suspense>` 只包住读 searchParams 的客户端筛选条。
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { PlazaFilterBar, ProjectGrid } from '@/components/project';
import { getSession } from '@/lib/auth';
import * as campaignService from '@/lib/campaign-service';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import * as favoriteService from '@/lib/favorite-service';
import { formatBytes, formatCount } from '@/lib/format';
import * as projectService from '@/lib/project-service';
import type { ProjectListQuery } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '作品广场',
  description: '每一件杰作，都始于一颗种子。浏览社区里正在生长的静态作品。',
  openGraph: {
    title: '作品广场',
    description: '每一件杰作，都始于一颗种子。浏览社区里正在生长的静态作品。',
    type: 'website',
    siteName: 'Kernel · 创意种子',
    locale: 'zh_CN',
  },
};

/** 页面参数（Next 15 起 searchParams 为 Promise）。 */
type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** 从 searchParams 取单值字符串。 */
function single(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** 归一化排序参数：new（默认）| votes；hot 尚未实现（UI 置灰）。 */
function normalizeSort(value: string): 'new' | 'votes' {
  return value === 'votes' ? 'votes' : 'new';
}

/** 拼接翻页链接，保留现有查询条件（q + sort + campaign）。 */
function pageHref(q: string, sort: 'new' | 'votes', campaign: string, page: number): string {
  const params = new URLSearchParams();
  if (q !== '') params.set('q', q);
  if (sort !== 'new') params.set('sort', sort);
  if (campaign !== '') params.set('campaign', campaign);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query === '' ? '/' : `/?${query}`;
}

export default async function PlazaPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = single(sp.q).trim();
  const sort = normalizeSort(single(sp.sort));
  const campaign = single(sp.campaign).trim();
  const parsedPage = Number.parseInt(single(sp.page), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const listQuery: ProjectListQuery = { q: q === '' ? undefined : q, page, pageSize: DEFAULT_PAGE_SIZE };
  if (sort !== 'new') listQuery.sort = sort;
  if (campaign !== '') listQuery.campaign = campaign;

  // P3 收藏：登录用户 SSR 取已收藏 id 集合 → 广场卡片右上角渲染星标（访客空集也显示，点击跳登录）
  const session = await getSession();
  const [result, summary, selectable, favoriteIds] = await Promise.all([
    projectService.list(listQuery),
    projectService.stats(),
    campaignService.listSelectable(),
    session ? favoriteService.myFavoriteIds(session.userId) : Promise.resolve([] as string[]),
  ]);
  const favoritedIds = new Set(favoriteIds);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <>
      <section className="hero">
        <div className="container-wide">
          <span className="hero__eyebrow">
            <span className="dot dot-live" aria-hidden="true" />
            本地开发桩 · P0 骨架已跑通
          </span>

          <h1 className="hero__title">
            每一件杰作，
            <br />
            都始于一颗<em>种子</em>。
          </h1>

          <p className="hero__slogan">
            <span>KERNEL</span>
            <i>上传 → 短码 → 分享，一分钟种下你的作品</i>
          </p>

          <div className="hero__actions">
            <Link className="btn btn-primary btn-lg" href="/new">
              发布我的作品
            </Link>
            <a className="btn btn-secondary btn-lg" href="#plaza">
              先逛逛广场
            </a>
          </div>

          <div className="hero__stats">
            <div>
              <div className="stat__num mono">{formatCount(summary.projects)}</div>
              <div className="stat__label">在线作品</div>
            </div>
            <div>
              <div className="stat__num mono">{formatCount(summary.views)}</div>
              <div className="stat__label">累计浏览</div>
            </div>
            <div>
              <div className="stat__num mono">{formatBytes(summary.bytes)}</div>
              <div className="stat__label">已托管内容</div>
            </div>
          </div>
        </div>
      </section>

      {/* useSearchParams 需要 Suspense 边界，否则整页会被强制降级为 CSR */}
      <Suspense fallback={<div className="filterbar" aria-hidden="true" />}>
        <PlazaFilterBar
          q={q}
          sort={sort}
          total={result.total}
          campaigns={selectable.map((item) => ({ slug: item.slug, title: item.title }))}
          campaign={campaign}
        />
      </Suspense>

      <div className="container-wide" id="plaza">
        <ProjectGrid
          projects={result.items}
          favoritedIds={favoritedIds}
          isLoggedIn={session !== null}
          emptyTitle={
            campaign !== ''
              ? '该活动还没有可展示的作品'
              : q === ''
                ? '广场上还没有作品'
                : `没有找到与「${q}」相关的作品`
          }
          emptyDescription={
            campaign !== ''
              ? '活动可能仍在征集期，或作品尚未公开。'
              : q === ''
                ? '成为第一个在这里种下种子的人。'
                : '换个关键词试试，或者直接发布你自己的作品。'
          }
          emptyAction={
            <Link className="btn btn-primary" href="/new">
              发布作品
            </Link>
          }
        />

        {totalPages > 1 ? (
          <nav className="pager" aria-label="分页">
            <Link
              className="btn btn-secondary btn-sm"
              href={pageHref(q, sort, campaign, Math.max(1, page - 1))}
              aria-disabled={page <= 1}
              tabIndex={page <= 1 ? -1 : undefined}
            >
              上一页
            </Link>

            <span className="pager__info mono">
              {page} / {totalPages}
            </span>

            <Link
              className="btn btn-secondary btn-sm"
              href={pageHref(q, sort, campaign, Math.min(totalPages, page + 1))}
              aria-disabled={page >= totalPages}
              tabIndex={page >= totalPages ? -1 : undefined}
            >
              下一页
            </Link>
          </nav>
        ) : null}

      </div>
    </>
  );
}
