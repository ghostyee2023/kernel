/**
 * GET /api/admin/campaigns/:id/export —— 活动成绩导出（P1 补）。
 *
 * 输出 CSV（UTF-8 BOM，Excel 可直接打开；零依赖，不引入 exceljs/xlsx）：
 *   第一行活动信息摘要，随后每作品一行（标题/短码/作者/活动票数/加入时间）。
 * 仅管理员可调（与其它 admin 接口一致）。
 */

import { requireUser, isAdminRole } from '@/lib/auth';
import { PROJECT_CAMPAIGN_STATUS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { AppError, ERROR_CODE, toErrorResponse } from '@/lib/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** CSV 转义：含逗号/引号/换行时包引号并把引号翻倍。 */
function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireUser();
    if (!isAdminRole(session.role)) {
      throw new AppError(ERROR_CODE.FORBIDDEN, '无权限');
    }

    const { id } = await context.params;
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        projects: {
          where: { status: PROJECT_CAMPAIGN_STATUS.JOINED },
          include: { project: { include: { author: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!campaign) throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);

    // 活动内每作品票数（仅有效票）
    const voteGroups = await prisma.vote.groupBy({
      by: ['projectId'],
      where: { campaignId: id, valid: true },
      _count: { projectId: true },
    });
    const voteMap = new Map(voteGroups.map((g) => [g.projectId, g._count.projectId]));
    const totalVotes = voteGroups.reduce((sum, g) => sum + g._count.projectId, 0);

    // 组 CSV（BOM 防 Excel 中文乱码）
    const lines: string[] = [];
    lines.push(
      ['活动', escapeCsv(campaign.title), '状态', campaign.status, '报名作品', String(campaign.projects.length), '有效票', String(totalVotes)].join(','),
    );
    lines.push(['作品标题', '短码', '作者', '活动票数', '加入时间'].join(','));
    for (const member of campaign.projects) {
      lines.push(
        [
          escapeCsv(member.project.title),
          escapeCsv(member.project.slug),
          escapeCsv(member.project.author?.nickname ?? member.project.authorAlias ?? '未知'),
          String(voteMap.get(member.projectId) ?? 0),
          member.joinedAt.toISOString(),
        ].join(','),
      );
    }
    const csv = `\uFEFF${lines.join('\r\n')}`;
    const filename = `campaign-${campaign.slug}-scores.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return toErrorResponse(error, 'admin:campaign:export');
  }
}
