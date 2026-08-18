/**
 * 投票领域服务。
 *
 * 设计真源：docs/03-数据模型与API.md §3.2（P1 第一阶段裁剪版，无 campaign）+ 
 * docs/P1-活动模块设计.md §1.4（P1 活动模块：campaignId 扩展）。
 *
 * 铁律：
 *   1. Route Handler 只做「解析入参 → 鉴权 → 调服务 → ok()/toErrorResponse()」，
 *      所有业务规则收敛在本文件，禁止在路由里写 prisma 查询。
 *   2. 幂等：重复投票 / 取消不存在票都不报错，只返回当前票数。
 *   3. 票数同步到 ProjectStats.voteCount（取消时下限 0，绝不为负）。
 *   4. 作品不可投票（不存在 / PRIVATE / 非 ACTIVE）统一走合理错误码，
 *      PRIVATE 与不存在保持一致的 404，不泄漏存在性。
 *   5. **投票兼容性铁律**：不带 `campaignId` 时，代码路径与既有实现完全一致
 *      （全站赞）；`@@unique([projectId, userId])` 不改 —— 活动票与全站赞互斥。
 */

import {
  AUDIT_ACTION,
  PROJECT_STATUS,
  RISK_BAN_THRESHOLD,
  RISK_IP_HIGH_FREQ_WINDOW_MS,
  RISK_SUSPICIOUS_THRESHOLD,
  USER_STATUS,
  VISIBILITY,
} from './constants';
import { computeStatus } from './campaign-service';
import { writeAudit } from './audit';
import { MS_PER_DAY } from './format';
import { prisma } from './prisma';
import { AppError, ERROR_CODE } from './response';
import { evaluateRisk } from './risk-service';
import { buildDetailUrl } from './sandbox';
import type { MyVoteFullDTO, ReceivedVoteDTO, RiskVoteLike, VoteOptions } from './types';

export type { VoteOptions } from './types';

/** 投票操作结果。 */
export interface VoteResult {
  /** 操作后该用户对该作品是否处于已投状态。 */
  voted: boolean;
  /** 操作后作品的累计有效票数。 */
  voteCount: number;
  /** 带 campaignId 时：该作品在本活动的票数（可选扩展，纯加法）。 */
  campaignVoteCount?: number;
  /** 带 campaignId 时：该用户在本活动的剩余票数（可选扩展，纯加法）。 */
  remainingQuota?: number;
}

/** 我投过的作品（GET /api/votes/me）。 */
export interface MyVote {
  projectId: string;
  /** ISO 8601 UTC */
  createdAt: string;
}

/** 校验作品是否可投票；不可投时抛错，可投时返回该作品行（含 authorId 供自投校验）。 */
async function assertVotable(projectId: string): Promise<{ id: string; authorId: string }> {
  if (typeof projectId !== 'string' || projectId.trim() === '') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '缺少作品标识');
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, visibility: true, status: true, authorId: true },
  });
  if (!project || project.visibility === VISIBILITY.PRIVATE) {
    throw new AppError(ERROR_CODE.NOT_FOUND);
  }
  if (project.status === PROJECT_STATUS.ARCHIVED) {
    throw new AppError(ERROR_CODE.GONE_ARCHIVED);
  }
  if (project.status !== PROJECT_STATUS.ACTIVE) {
    throw new AppError(ERROR_CODE.NOT_FOUND);
  }
  return project;
}

/** 读取当前票数（作品不存在时返回 0）。 */
async function currentVoteCount(projectId: string): Promise<number> {
  const stats = await prisma.projectStats.findUnique({
    where: { projectId },
    select: { voteCount: true },
  });
  return stats?.voteCount ?? 0;
}

/** 活动内某作品票数（Vote where campaignId AND projectId AND valid=true 的 COUNT，实时聚合）。 */
export async function campaignVoteCount(campaignId: string, projectId: string): Promise<number> {
  return prisma.vote.count({ where: { campaignId, projectId, valid: true } });
}

/** 活动内某用户的已用票数（跨作品累计；只计有效票，作废票退回额度 Q1）。 */
async function usedQuota(campaignId: string, userId: string): Promise<number> {
  return prisma.vote.count({ where: { campaignId, userId, valid: true } });
}

/**
 * 投票前风控评估：取最近窗口票（同 IP 1min / 同 IP 24h / 同设备 24h，3 个 bounded 查询）
 * → `evaluateRisk`（纯函数）→ 返回 riskScore。
 *
 * 约定（docs/P2-风控模块设计.md §1.4）：查询发生在 INSERT 之前，因此把「当前票」
 * 追加进三个窗口数组，使「第 5 票触发 IP_HIGH_FREQ」等验收口径成立；
 * 无 ip / deviceHash 时（本地桩裸投）跳过查询，riskScore=0（与现状一致）。
 */
async function evaluateVoteRisk(
  userId: string,
  ip: string | undefined,
  deviceHash: string | undefined,
  dwellMs: number | undefined,
  now: Date,
): Promise<number> {
  if (!ip && !deviceHash) return 0;

  const dayAgo = new Date(now.getTime() - MS_PER_DAY);
  const recentSince = new Date(now.getTime() - RISK_IP_HIGH_FREQ_WINDOW_MS);
  const select = { userId: true, ip: true, deviceHash: true, dwellMs: true, createdAt: true } as const;

  const [sameIpRecent, sameIpAll, sameDeviceAll] = await Promise.all([
    ip
      ? prisma.vote.findMany({
          where: { ip, createdAt: { gt: recentSince } },
          select,
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : Promise.resolve([]),
    ip
      ? prisma.vote.findMany({
          where: { ip, createdAt: { gt: dayAgo } },
          select,
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      : Promise.resolve([]),
    deviceHash
      ? prisma.vote.findMany({
          where: { deviceHash, createdAt: { gt: dayAgo } },
          select,
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  const current: RiskVoteLike = { userId, ip: ip ?? null, deviceHash: deviceHash ?? null, dwellMs: dwellMs ?? null, createdAt: now };
  const verdict = evaluateRisk({
    userId,
    ip,
    deviceHash,
    now,
    sameIpRecent: [...sameIpRecent, current],
    sameIpAll: [...sameIpAll, current],
    sameDeviceAll: [...sameDeviceAll, current],
  });
  return verdict.score;
}

/** P2 补：投票后同步用户风险等级；达封禁阈值自动封禁（风险联动，失败不阻断投票）。 */
async function syncUserRisk(userId: string, riskScore: number): Promise<void> {
  if (!riskScore || riskScore < RISK_SUSPICIOUS_THRESHOLD) return; // 低风险不升级
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, riskLevel: true, status: true },
    });
    if (!user) return;
    const level = Math.max(user.riskLevel, riskScore);
    if (level > user.riskLevel) {
      await prisma.user.update({ where: { id: userId }, data: { riskLevel: level } });
    }
    if (level >= RISK_BAN_THRESHOLD && user.status !== USER_STATUS.BANNED) {
      await prisma.user.update({ where: { id: userId }, data: { status: USER_STATUS.BANNED } });
      await writeAudit({
        actorId: userId,
        action: AUDIT_ACTION.USER_BAN,
        targetType: 'user',
        targetId: userId,
        detail: '风控自动封禁（风险分达阈值）',
        meta: { reason: 'auto_ban', riskLevel: level, source: 'vote' },
      });
    }
  } catch (error) {
    console.warn('[vote][risk-sync] failed', error);
  }
}

/**
 * 投一票（幂等）。
 *
 * 带 campaignId 时的校验链（docs/P1-活动模块设计.md §1.4，顺序即优先级）：
 *   ① campaign 存在            → 404 CAMP_NOT_FOUND
 *   ② computeStatus === voting 且 now < voteEndAt → 409 CAMP_NOT_OPEN
 *   ③ 作品已报名（joined）      → 409 CAMP_PROJECT_NOT_JOINED
 *   ④ assertVotable            → 404 NOT_FOUND / 410 GONE_ARCHIVED
 *   ⑤ !allowSelfVote 且自投     → 403 SELF_VOTE_FORBIDDEN
 *   ⑥ 已存在 (projectId,userId) → 幂等返回当前状态（不重复计票）
 *   ⑦ 计数检查 + 插入 + stats+1 在同一交互事务（极端并发最多超 1 票，本地桩可接受）
 *
 * 不带 campaignId：与既有实现完全一致（全站赞）。
 *
 * @throws AppError NOT_LOGGED_IN 由调用方鉴权抛出
 * @throws AppError NOT_FOUND / GONE_ARCHIVED 作品不可投票
 */
export async function vote(projectId: string, userId: string, options?: VoteOptions): Promise<VoteResult> {
  const campaignId = options?.campaignId;
  // P2 风控：可空字段缺省走现状路径（裸投 riskScore=0）
  const ip = typeof options?.ip === 'string' && options.ip.trim() !== '' ? options.ip.trim() : undefined;
  const deviceHash =
    typeof options?.deviceHash === 'string' && options.deviceHash.trim() !== '' ? options.deviceHash.trim() : undefined;
  const dwellMs =
    typeof options?.dwellMs === 'number' && Number.isFinite(options.dwellMs) && options.dwellMs >= 0
      ? Math.floor(options.dwellMs)
      : undefined;

  // ① ② ③：活动侧校验（先于作品校验，对齐 §1.4 顺序）
  let campaign: { id: string; maxVotesPerUser: number; allowSelfVote: boolean } | null = null;
  if (campaignId) {
    const row = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        status: true,
        collectEndAt: true,
        voteStartAt: true,
        voteEndAt: true,
        maxVotesPerUser: true,
        allowSelfVote: true,
      },
    });
    if (!row) throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);

    const effective = computeStatus(row);
    // draft 与「不存在」表现一致（不泄漏存在性）
    if (effective === 'draft') {
      throw new AppError(ERROR_CODE.CAMP_NOT_FOUND);
    }
    const now = new Date();
    if (effective !== 'voting' || (row.voteEndAt && now.getTime() >= row.voteEndAt.getTime())) {
      throw new AppError(ERROR_CODE.CAMP_NOT_OPEN, undefined, { status: effective });
    }
    campaign = { id: row.id, maxVotesPerUser: row.maxVotesPerUser, allowSelfVote: row.allowSelfVote };

    const member = await prisma.projectCampaign.findUnique({
      where: { campaignId_projectId: { campaignId: row.id, projectId } },
      select: { status: true },
    });
    if (!member || member.status !== 'joined') {
      throw new AppError(ERROR_CODE.CAMP_PROJECT_NOT_JOINED);
    }
  }

  // ④ 作品可投
  const project = await assertVotable(projectId);

  // ⑤ 自投开关
  if (campaignId && !campaign?.allowSelfVote && project.authorId === userId) {
    throw new AppError(ERROR_CODE.SELF_VOTE_FORBIDDEN);
  }

  // ⑥ 已投 → 幂等返回
  const existing = await prisma.vote.findUnique({
    where: { projectId_userId: { projectId: project.id, userId } },
    select: { id: true },
  });
  if (existing) {
    const voteCount = await currentVoteCount(project.id);
    if (campaignId) {
      const max = campaign?.maxVotesPerUser ?? 3;
      return {
        voted: true,
        voteCount,
        campaignVoteCount: await campaignVoteCount(campaignId, project.id),
        remainingQuota: Math.max(0, max - (await usedQuota(campaignId, userId))),
      };
    }
    return { voted: true, voteCount };
  }

  // P2 风控：插入前评估风险分（取最近窗口票 + 当前票，纯函数聚合），随 INSERT 落库
  const now = new Date();
  const riskScore = await evaluateVoteRisk(userId, ip, deviceHash, dwellMs, now);

  if (campaignId) {
    // ⑦ 交互事务：计数检查 + 插入 + stats+1 合并，降低并发超票概率
    const max = campaign?.maxVotesPerUser ?? 3;
    try {
      await prisma.$transaction(async (tx) => {
        // quota 只计有效票（作废票退回额度 Q1）
        const used = await tx.vote.count({ where: { campaignId, userId, valid: true } });
        if (used >= max) {
          throw new AppError(ERROR_CODE.VOTE_QUOTA_EXCEEDED, `本活动每人最多投 ${max} 票，已达上限`, {
            max,
            used,
          });
        }
        await tx.vote.create({
          data: { projectId: project.id, userId, campaignId, ip, deviceHash, dwellMs, riskScore },
        });
        await tx.projectStats.upsert({
          where: { projectId: project.id },
          update: { voteCount: { increment: 1 } },
          create: { projectId: project.id, voteCount: 1 },
        });
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        // 并发下两人同时首次投票时，一方会撞上 @@unique([projectId, userId])
        const voteCount = await currentVoteCount(project.id);
        return {
          voted: true,
          voteCount,
          campaignVoteCount: await campaignVoteCount(campaignId, project.id),
          remainingQuota: Math.max(0, max - (await usedQuota(campaignId, userId))),
        };
      }
      throw error;
    }
    console.log(`[vote][create] projectId=${project.id} userId=${userId} campaignId=${campaignId} riskScore=${riskScore}`);
    await syncUserRisk(userId, riskScore);
    return {
      voted: true,
      voteCount: await currentVoteCount(project.id),
      campaignVoteCount: await campaignVoteCount(campaignId, project.id),
      remainingQuota: Math.max(0, max - (await usedQuota(campaignId, userId))),
    };
  }

  // 不带 campaignId：既有路径保留（仅 INSERT 增加风控字段）
  try {
    await prisma.$transaction([
      prisma.vote.create({ data: { projectId: project.id, userId, ip, deviceHash, dwellMs, riskScore } }),
      prisma.projectStats.upsert({
        where: { projectId: project.id },
        update: { voteCount: { increment: 1 } },
        create: { projectId: project.id, voteCount: 1 },
      }),
    ]);
  } catch (error) {
    // 并发下两人同时首次投票时，一方会撞上 @@unique([projectId, userId])
    const code = (error as { code?: string }).code;
    if (code === 'P2002') {
      return { voted: true, voteCount: await currentVoteCount(project.id) };
    }
    throw error;
  }

  await syncUserRisk(userId, riskScore);

  console.log(`[vote][create] projectId=${project.id} userId=${userId} riskScore=${riskScore}`);
  return { voted: true, voteCount: await currentVoteCount(project.id) };
}

/**
 * 取消自己投的票（幂等）。
 *
 * 规则：
 *   - 没投过 → 不报错，直接返回当前票数；
 *   - 有效票 → 删 Vote + `voteCount decrement 1`（下限 0，同一事务）；
 *   - **已作废票 → 只删行不减票**（作废时已从 stats 剔除，防止重复双扣，D3）。
 * 活动票是 COUNT 实时聚合，删除后活动内票数自然回落（DELETE 端点不改）。
 */
export async function unvote(projectId: string, userId: string): Promise<VoteResult> {
  if (typeof projectId !== 'string' || projectId.trim() === '') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '缺少作品标识');
  }

  const existing = await prisma.vote.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true, valid: true },
  });
  if (!existing) {
    return { voted: false, voteCount: await currentVoteCount(projectId) };
  }

  if (existing.valid) {
    await prisma.$transaction([
      prisma.vote.delete({ where: { projectId_userId: { projectId, userId } } }),
      // 用 updateMany + gt 0 保证票数下限 0，绝不因数据不一致变负
      prisma.projectStats.updateMany({
        where: { projectId, voteCount: { gt: 0 } },
        data: { voteCount: { decrement: 1 } },
      }),
    ]);
  } else {
    // 作废票：只删行不减票（作废时已从 ProjectStats 剔除）
    await prisma.vote.delete({ where: { projectId_userId: { projectId, userId } } });
    console.log(`[vote][delete-invalid] projectId=${projectId} userId=${userId}`);
  }

  console.log(`[vote][delete] projectId=${projectId} userId=${userId}`);
  return { voted: false, voteCount: await currentVoteCount(projectId) };
}

/** 我投过的作品列表（按投票时间倒序；只返回有效票，被作废的票不展示 Q6）。 */
export async function myVotes(userId: string): Promise<MyVote[]> {
  const rows = await prisma.vote.findMany({
    where: { userId, valid: true },
    orderBy: { createdAt: 'desc' },
    select: { projectId: true, createdAt: true },
  });
  return rows.map((row) => ({ projectId: row.projectId, createdAt: row.createdAt.toISOString() }));
}

/**
 * 当前用户是否已投过某作品（详情页 SSR 用）。
 */
export async function hasVoted(projectId: string, userId: string): Promise<boolean> {
  const row = await prisma.vote.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true },
  });
  return row !== null;
}

/* ============================================================================
   P3.5 我的投票（双栏 loader，设计真源：docs/P3-我的后台设计.md §1.5）
   ========================================================================== */

/**
 * 我投出的全部票（P3.5 我的投票左栏）——**不过滤 valid**，作废票返回
 * `valid=false + invalidReason` 由展示层画「已作废」徽章；与 `myVotes()`（仅有效，
 * 供详情页「已投过」判断）并存、互不替换。排序：投票时间倒序。
 */
export async function myVotesFull(userId: string): Promise<MyVoteFullDTO[]> {
  const rows = await prisma.vote.findMany({
    where: { userId },
    include: {
      project: { include: { author: true, stats: true } },
      campaign: { select: { title: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((row) => ({
    id: row.id,
    project: {
      id: row.project.id,
      slug: row.project.slug,
      title: row.project.title,
      status: row.project.status as (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS],
      visibility: row.project.visibility as (typeof VISIBILITY)[keyof typeof VISIBILITY],
      detailUrl: buildDetailUrl(row.project.slug),
    },
    campaignId: row.campaignId,
    campaignTitle: row.campaign?.title ?? null,
    valid: row.valid,
    invalidReason: row.invalidReason,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * 我收到的票（P3.5 我的投票右栏）——有效票按 作品×活动 聚合。
 *
 * 口径：`COUNT(valid=true)` 按 `[projectId, campaignId]` 分组（where 限定
 * `project.authorId = 本人`），与 `ProjectStats.voteCount` 同口径（作废票已剔除）；
 * 右栏票数合计 = 概览 KPI「累计票数」。排序：票数倒序（稳定键 projectId）。
 */
export async function votesReceivedByProject(userId: string): Promise<ReceivedVoteDTO[]> {
  const groups = await prisma.vote.groupBy({
    by: ['projectId', 'campaignId'],
    where: { valid: true, project: { authorId: userId } },
    _count: { _all: true },
  });
  if (groups.length === 0) return [];

  const projectIds = [...new Set(groups.map((row) => row.projectId))];
  const campaignIds = [
    ...new Set(groups.map((row) => row.campaignId).filter((id): id is string => id !== null)),
  ];

  const [projects, campaigns] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, slug: true, title: true, status: true },
    }),
    campaignIds.length > 0
      ? prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, title: true } })
      : Promise.resolve([]),
  ]);

  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const campaignMap = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

  return groups
    .map((row): ReceivedVoteDTO | null => {
      const project = projectMap.get(row.projectId);
      if (!project) return null;
      const campaign = row.campaignId ? campaignMap.get(row.campaignId) : undefined;
      return {
        projectId: project.id,
        slug: project.slug,
        title: project.title,
        projectStatus: project.status as (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS],
        campaignId: row.campaignId,
        campaignTitle: campaign?.title ?? null,
        voteCount: row._count._all,
      };
    })
    .filter((item): item is ReceivedVoteDTO => item !== null)
    .sort((a, b) => b.voteCount - a.voteCount || a.projectId.localeCompare(b.projectId));
}
