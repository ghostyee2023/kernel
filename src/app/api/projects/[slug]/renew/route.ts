/**
 * POST /api/projects/{slug}/renew
 *
 * 续期。已归档（回收站期内）的作品续期即复活：status 回到 ACTIVE。
 * 已 PURGED（磁盘已删）的作品无法复活，返回 404。
 *
 * 鉴权：仅作者本人或 ADMIN 可续期（docs/03 §3.1：作者 or 管理员）。
 */

import type { NextRequest } from 'next/server';

import { canManageProject, requireUser } from '@/lib/auth';
import { DEFAULT_TTL_DAYS } from '@/lib/constants';
import * as projectService from '@/lib/project-service';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Next 15 起动态参数为 Promise。 */
type Context = { params: Promise<{ slug: string }> };

/** 请求体。 */
interface RenewBody {
  ttlDays?: unknown;
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;

    // 鉴权最先：登录 + 作者/管理员校验（先取作者信息再判权限）
    const session = await requireUser();
    const dto = await projectService.peek(slug);
    if (!dto) throw new AppError(ERROR_CODE.NOT_FOUND);
    if (!canManageProject(session, dto)) throw new AppError(ERROR_CODE.FORBIDDEN);

    let body: RenewBody = {};
    try {
      const text = await request.text();
      body = text.trim() === '' ? {} : (JSON.parse(text) as RenewBody);
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    const ttlDays = body.ttlDays == null ? DEFAULT_TTL_DAYS : Number(body.ttlDays);
    const renewed = await projectService.renew(slug, ttlDays);

    return ok({
      slug: renewed.slug,
      status: renewed.status,
      ttlDays: renewed.ttlDays,
      expireAt: renewed.expireAt,
    });
  } catch (error) {
    return toErrorResponse(error, 'projects:renew');
  }
}
