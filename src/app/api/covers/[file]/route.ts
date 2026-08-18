/**
 * GET /api/covers/{slug}.svg
 *
 * 下发确定性生成的 SVG 占位封面。
 *
 * 为什么不用 `public/`：封面随作品生命周期一起被清理，放 `public/` 会和构建产物混在一起；
 * 走 Route Handler 可以复用 `.kernel-data` 目录，purge 时一并回收。
 *
 * 缓存策略：文件内容由 slug 决定、永不变化，直接 immutable。
 *
 * P1 活动模块：`camp-*` 前缀的 slug 视为活动封面，磁盘缺失时走
 * `buildCampaignCoverSvg`（活动不落盘，按 DB 标题即时生成）。
 */

import { buildCampaignCoverSvg, buildCoverSvg } from '@/lib/cover';
import { prisma } from '@/lib/prisma';
import { toErrorResponse } from '@/lib/response';
import { coverFilePath, pathExists, readTextFile } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> },
): Promise<Response> {
  try {
    const { file } = await context.params;

    if (!file.endsWith('.svg')) {
      return new Response('Not Found', { status: 404 });
    }
    const slug = file.slice(0, -'.svg'.length);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(slug)) {
      return new Response('Not Found', { status: 404 });
    }

    let svg: string;
    const diskPath = coverFilePath(slug);
    if (await pathExists(diskPath)) {
      svg = await readTextFile(diskPath);
    } else if (slug.startsWith('camp-')) {
      // 活动封面：查 DB 拿标题，确定性渐变占位（零新增依赖，无上传链路）
      const campaign = await prisma.campaign.findUnique({ where: { slug }, select: { title: true } });
      svg = buildCampaignCoverSvg(slug, campaign?.title ?? slug);
    } else {
      // 磁盘缺失时即时生成，保证列表页永不出现破图
      svg = buildCoverSvg(slug, slug);
    }

    return new Response(svg, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return toErrorResponse(error, 'covers');
  }
}
