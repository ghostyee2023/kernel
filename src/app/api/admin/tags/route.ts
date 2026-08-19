/**
 * /api/admin/tags
 *
 *   GET   后台标签列表（可 kind / q 过滤，含作品数）
 *   POST  创建自定义标签 { name }
 *
 * 鉴权：requireAdmin（仅管理员）。
 */

import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { ok, toErrorResponse } from '@/lib/response';
import { createTag, listAdminTags } from '@/lib/tag-service';
import type { AdminTagListQuery } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const query: AdminTagListQuery = {
      q: url.searchParams.get('q') ?? undefined,
      kind: url.searchParams.get('kind') ?? undefined,
    };
    const tags = await listAdminTags(query);
    return ok(tags);
  } catch (error) {
    return toErrorResponse(error, 'admin:tags:list');
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    await requireAdmin();
    let body: { name?: unknown };
    try {
      body = (await request.json()) as { name?: unknown };
    } catch {
      body = {};
    }
    const tag = await createTag(body.name);
    return ok(tag, undefined, 201);
  } catch (error) {
    return toErrorResponse(error, 'admin:tags:create');
  }
}
