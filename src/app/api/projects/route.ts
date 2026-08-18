/**
 * /api/projects
 *
 *   GET  列出广场作品（仅 PUBLIC + ACTIVE，分页）
 *   POST 创建作品（消费 upload-complete 的校验结果，或直接登记外链）
 */

import type { NextRequest } from 'next/server';

import { requireUser } from '@/lib/auth';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import * as projectService from '@/lib/project-service';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import { ensureDataSkeleton } from '@/lib/storage';
import type { CreateProjectInput, ProjectListQuery } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 从查询串解析列表参数。 */
function parseQuery(url: URL): ProjectListQuery {
  const sortRaw = url.searchParams.get('sort');
  const sort = sortRaw === 'votes' ? 'votes' : sortRaw === 'hot' ? 'hot' : 'new';
  return {
    sort,
    q: url.searchParams.get('q') ?? undefined,
    page: Number(url.searchParams.get('page') ?? 1),
    pageSize: Number(url.searchParams.get('pageSize') ?? DEFAULT_PAGE_SIZE),
  };
}

export async function GET(request: NextRequest) {
  try {
    const result = await projectService.list(parseQuery(new URL(request.url)));
    return ok(result.items, {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    });
  } catch (error) {
    return toErrorResponse(error, 'projects:list');
  }
}

export async function POST(request: NextRequest) {
  try {
    // 鉴权最先：发布作品必须登录（docs/03 §3.1：POST /api/projects → 登录）
    const session = await requireUser();
    await ensureDataSkeleton();

    let body: CreateProjectInput;
    try {
      body = (await request.json()) as CreateProjectInput;
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    // authorId 一律取自会话，忽略请求体里的同名脏字段
    const result = await projectService.create({ ...body, authorId: session.userId });
    return ok(result, undefined, 201);
  } catch (error) {
    return toErrorResponse(error, 'projects:create');
  }
}
