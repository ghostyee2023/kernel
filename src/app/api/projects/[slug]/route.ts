/**
 * /api/projects/{slug}
 *
 *   GET    读取作品详情（PRIVATE 与不存在统一 404，不泄漏存在性）
 *   PATCH  局部更新（title / summary / description / visibility / authorAlias）
 *   DELETE 软删除进回收站（ARCHIVED，30 天后由清理任务物理删除）
 *
 * PATCH / DELETE 鉴权：仅作者本人（authorId === session.userId）或 ADMIN 可操作
 * （docs/03 §3.1：作者 or 管理员）。owner 校验写在 route 层，业务服务不感知身份。
 */

import type { NextRequest } from 'next/server';

import { canManageProject, requireUser } from '@/lib/auth';
import * as projectService from '@/lib/project-service';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import type { PatchProjectInput } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Next 15 起动态参数为 Promise。 */
type Context = { params: Promise<{ slug: string }> };

/**
 * 校验当前会话可管理该作品：先取作者信息再判权限。
 *
 * @throws AppError NOT_FOUND 作品不存在 / 已 PURGED
 * @throws AppError NOT_LOGGED_IN 未登录
 * @throws AppError FORBIDDEN 非作者且非管理员
 */
async function assertCanManage(slug: string) {
  const session = await requireUser();
  const dto = await projectService.peek(slug);
  if (!dto) throw new AppError(ERROR_CODE.NOT_FOUND);
  if (!canManageProject(session, dto)) throw new AppError(ERROR_CODE.FORBIDDEN);
  return dto;
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === '1';

    const dto = await projectService.getBySlug(slug, {
      allowArchived: includeArchived,
      // PRIVATE 一律 404，与详情页 /w/[slug] 表现一致，不泄漏存在性（P0 §7.4 / Q4）
      allowPrivate: false,
    });
    return ok(dto);
  } catch (error) {
    return toErrorResponse(error, 'projects:get');
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    await assertCanManage(slug);

    let body: PatchProjectInput;
    try {
      body = (await request.json()) as PatchProjectInput;
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    const dto = await projectService.patch(slug, body);
    return ok(dto);
  } catch (error) {
    return toErrorResponse(error, 'projects:patch');
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    await assertCanManage(slug);
    const dto = await projectService.softDelete(slug);
    return ok({ slug: dto.slug, status: dto.status, purgeAt: dto.purgeAt });
  } catch (error) {
    return toErrorResponse(error, 'projects:delete');
  }
}
