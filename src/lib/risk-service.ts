/**
 * 风控领域服务（P2 风控模块）。
 *
 * 设计真源：docs/P2-风控模块设计.md §1.4 / §1.6 / §1.7。
 *
 * 铁律：
 *   1. **规则函数与 `evaluateRisk` 是纯函数**：入参为 `RiskVoteLike[]` 普通对象
 *      + `RiskRuleContext{now}`，禁止触碰 DB；阈值全部经 constants 读取（可注入单测）。
 *   2. 审计聚合用 `prisma.$queryRaw` 原生 SQL（SQLite 的 `groupBy` 不支持
 *      `COUNT(DISTINCT)`）；`col` 必须经白名单映射 `{ ip, device, user }`，
 *      禁止拼接自由字符串（防注入）。
 *   3. `invalidate` 单个交互事务完成「作废 → 受影响作品 voteCount 全量重算 →
 *      voteInvalid 累加 → writeAudit」；审计写失败不阻断主流程（writeAudit 内 try/catch）。
 *   4. 幂等：已作废票 / 不存在的 id 自动跳过；空集返回 invalidated=0（200，不报错）。
 */

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { writeAudit } from './audit';
import {
  ADMIN_BATCH_MAX_IDS,
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_MAX_PAGE_SIZE,
  AUDIT_ACTION,
  RISK_DEVICE_MULTI_ACCOUNT_SCORE,
  RISK_DEVICE_MULTI_ACCOUNT_THRESHOLD,
  RISK_HIGH_THRESHOLD,
  RISK_IP_HIGH_FREQ_SCORE,
  RISK_IP_HIGH_FREQ_THRESHOLD,
  RISK_IP_MULTI_ACCOUNT_SCORE,
  RISK_IP_MULTI_ACCOUNT_THRESHOLD,
  RISK_MAX_SCORE,
  RISK_RAPID_CONSECUTIVE_SCORE,
  RISK_RAPID_COUNT,
  RISK_RAPID_GAP_MS,
  RISK_REASON_MAX_LEN,
  RISK_RULE_CODE,
  RISK_SUSPICIOUS_THRESHOLD,
  type RiskLevel,
} from './constants';
import { prisma } from './prisma';
import { AppError, ERROR_CODE } from './response';
import type {
  InvalidateInput,
  InvalidateResult,
  PagedResult,
  RiskAuditQuery,
  RiskDetailQuery,
  RiskGroup,
  RiskGroupDTO,
  RiskRuleResult,
  RiskSummary,
  RiskVerdict,
  RiskVoteDTO,
  RiskVoteLike,
} from './types';

/* ============================================================================
   0) 规则引擎 —— 纯函数（不碰 DB，入参为普通对象，阈值经 constants 读取）
   ========================================================================== */

/** 规则求值上下文。 */
export interface RiskRuleContext {
  now: Date;
}

/** 规则入参的「票」：纯数据，非 Prisma 类型。 */
export type { RiskVoteLike };

/** 规则评估输入。 */
export interface RiskEvaluateInput {
  userId: string;
  ip?: string;
  deviceHash?: string;
  /** 缺省 Date.now()（便于测试注入）。 */
  now?: Date;
  /** 最近 1 分钟同 IP 票（含当前票，由调用方在插入前取数后追加）。 */
  sameIpRecent: RiskVoteLike[];
  /** 最近 24h 同 IP 票（含当前票）。 */
  sameIpAll: RiskVoteLike[];
  /** 最近 24h 同设备票（含当前票）。 */
  sameDeviceAll: RiskVoteLike[];
}

/** 时间归一化：Date | string → epoch ms。 */
function timeOf(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * $queryRaw 时间值归一化为 ISO 串。
 * SQLite 下 `MAX(createdAt)` 会以 BigInt（epoch ms）返回，而列直取是 Date 对象，
 * 因此统一处理 Date / string / number / bigint。
 */
function toIsoString(value: string | Date | bigint | number | null | undefined): string {
  if (value == null) return new Date(0).toISOString();
  if (typeof value === 'bigint') return new Date(Number(value)).toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  return new Date(value).toISOString();
}

/** 同 IP 高频：1 分钟窗口内票数 ≥ 5 → +30。 */
export function ruleIpHighFreq(votes: RiskVoteLike[], _ctx: RiskRuleContext): RiskRuleResult[] {
  if (votes.length >= RISK_IP_HIGH_FREQ_THRESHOLD) {
    return [
      {
        code: RISK_RULE_CODE.IP_HIGH_FREQ,
        score: RISK_IP_HIGH_FREQ_SCORE,
        reason: `1 分钟内同 IP 投票 ${votes.length} 次`,
        label: '同 IP 高频投票',
      },
    ];
  }
  return [];
}

/** 同 IP 多账号：24h 窗口内去重 userId ≥ 3 → +25。 */
export function ruleIpMultiAccount(votes: RiskVoteLike[], _ctx: RiskRuleContext): RiskRuleResult[] {
  const users = new Set(votes.map((vote) => vote.userId));
  if (users.size >= RISK_IP_MULTI_ACCOUNT_THRESHOLD) {
    return [
      {
        code: RISK_RULE_CODE.IP_MULTI_ACCOUNT,
        score: RISK_IP_MULTI_ACCOUNT_SCORE,
        reason: `同 IP 关联 ${users.size} 个账号`,
        label: '同 IP 多账号',
      },
    ];
  }
  return [];
}

/** 同设备多账号：24h 窗口内去重 userId ≥ 3 → +35。 */
export function ruleDeviceMultiAccount(votes: RiskVoteLike[], _ctx: RiskRuleContext): RiskRuleResult[] {
  const users = new Set(votes.map((vote) => vote.userId));
  if (users.size >= RISK_DEVICE_MULTI_ACCOUNT_THRESHOLD) {
    return [
      {
        code: RISK_RULE_CODE.DEVICE_MULTI_ACCOUNT,
        score: RISK_DEVICE_MULTI_ACCOUNT_SCORE,
        reason: `同设备关联 ${users.size} 个账号`,
        label: '同设备多账号',
      },
    ];
  }
  return [];
}

/**
 * 秒级连投：24h 窗口内同设备按 createdAt 倒序，连续 ≥ 3 条且相邻间隔 ≤ 3s → +20。
 *
 * 语义：从最新一条（含当前票）向前数，只要相邻间隔 ≤ RISK_RAPID_GAP_MS 就并入
 * 连续链；链长 ≥ RISK_RAPID_COUNT 触发。reason 的 N = 连续链总跨度秒数（向上取整）。
 */
export function ruleRapidConsecutive(votes: RiskVoteLike[], _ctx: RiskRuleContext): RiskRuleResult[] {
  const sorted = [...votes].sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
  if (sorted.length < RISK_RAPID_COUNT) return [];

  let count = 1;
  let newestMs = timeOf(sorted[0].createdAt);
  let oldestMs = newestMs;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = timeOf(sorted[i - 1].createdAt) - timeOf(sorted[i].createdAt);
    if (gap < 0 || gap > RISK_RAPID_GAP_MS) break;
    count += 1;
    oldestMs = timeOf(sorted[i].createdAt);
  }
  if (count < RISK_RAPID_COUNT) return [];

  const spanSeconds = Math.max(1, Math.ceil((newestMs - oldestMs) / 1000));
  return [
    {
      code: RISK_RULE_CODE.RAPID_CONSECUTIVE,
      score: RISK_RAPID_CONSECUTIVE_SCORE,
      reason: `${spanSeconds} 秒内连续投票 ${count} 次`,
      label: '秒级连投',
    },
  ];
}

/** riskScore → 风险等级（normal / suspect / high）。 */
export function riskLevelOf(score: number): RiskLevel {
  if (score >= RISK_HIGH_THRESHOLD) return 'high';
  if (score >= RISK_SUSPICIOUS_THRESHOLD) return 'suspect';
  return 'normal';
}

/**
 * 聚合评估（纯函数）：逐条规则求值、score 求和（上限 RISK_MAX_SCORE）、拼接 reasons。
 *
 * @param input 含同 IP 最近 1min / 同 IP 24h / 同设备 24h 三组窗口票 + 当前票。
 * @returns { score, reasons, suspicious }。
 */
export function evaluateRisk(input: RiskEvaluateInput): RiskVerdict {
  const ctx: RiskRuleContext = { now: input.now ?? new Date() };
  const reasons: RiskRuleResult[] = [
    ...ruleIpHighFreq(input.sameIpRecent, ctx),
    ...ruleIpMultiAccount(input.sameIpAll, ctx),
    ...ruleDeviceMultiAccount(input.sameDeviceAll, ctx),
    ...ruleRapidConsecutive(input.sameDeviceAll, ctx),
  ];
  const score = Math.min(RISK_MAX_SCORE, reasons.reduce((sum, item) => sum + item.score, 0));
  return { score, reasons, suspicious: score >= RISK_SUSPICIOUS_THRESHOLD };
}

/* ============================================================================
   1) 审计聚合（GROUP BY）—— admin 查询
   ========================================================================== */

/** 分组维度 → 列名白名单映射（禁止拼接自由字符串，防注入）。 */
const GROUP_COL: Record<RiskGroup, string> = {
  ip: 'ip',
  device: 'deviceHash',
  user: 'userId',
};

/** 后台分页归一化：page ≥ 1；pageSize 默认 20、上限 100。 */
function normalizeAdminPaging(page?: number, pageSize?: number): { page: number; pageSize: number } {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const rawSize = Math.floor(Number(pageSize) || ADMIN_DEFAULT_PAGE_SIZE);
  const size = Math.min(ADMIN_MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page: p, pageSize: size };
}

/** 归一化分组维度；非法值抛 VALIDATION_FAILED。 */
function normalizeGroup(value: unknown): RiskGroup {
  if (value === 'ip' || value === 'device' || value === 'user') return value;
  throw new AppError(ERROR_CODE.VALIDATION_FAILED, '分组维度取值不合法');
}

/** 归一化 campaignId（空串归一 undefined）。 */
function normalizeCampaignId(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? undefined : trimmed;
}

/** 分组条件 SQL：`col IS NOT NULL AND col != '' [AND campaignId = ?]`。 */
function groupWhereSql(col: string, campaignId: string | undefined): Prisma.Sql {
  const campaignSql = campaignId ? Prisma.sql` AND campaignId = ${campaignId}` : Prisma.empty;
  return Prisma.sql`${Prisma.raw(col)} IS NOT NULL AND ${Prisma.raw(col)} != ''${campaignSql}`;
}

/** 审计聚合行（$queryRaw 原始行）。 */
interface AuditGroupRow {
  key: string;
  voteCount: number | bigint;
  validCount: number | bigint;
  invalidCount: number | bigint;
  accountCount: number | bigint;
  deviceCount: number | bigint;
  projectCount: number | bigint;
  maxRiskScore: number | bigint | null;
  latestAt: string | Date | bigint | number | null;
}

/**
 * 审计聚合（docs/P2-风控模块设计.md §1.6）：
 * 按 `group`（ip/device/user）分组，产出票数 / 有效票 / 作废票 / 涉及账号 / 设备 /
 * 作品 / 最高风险分 / 最近投票时间；可选 campaign 过滤与仅看可疑。
 */
export async function auditGroups(query: RiskAuditQuery): Promise<PagedResult<RiskGroupDTO>> {
  const group = normalizeGroup(query.group ?? 'ip');
  const col = GROUP_COL[group];
  const campaignId = normalizeCampaignId(query.campaignId);
  const suspiciousOnly = Boolean(query.suspiciousOnly);
  const { page, pageSize } = normalizeAdminPaging(query.page, query.pageSize);
  const whereSql = groupWhereSql(col, campaignId);
  const havingSql = suspiciousOnly
    ? Prisma.sql`HAVING MAX(riskScore) >= ${RISK_SUSPICIOUS_THRESHOLD}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<AuditGroupRow[]>(Prisma.sql`
    SELECT ${Prisma.raw(col)} AS key,
           COUNT(*)                                                          AS voteCount,
           SUM(CASE WHEN valid = 1 THEN 1 ELSE 0 END)                        AS validCount,
           SUM(CASE WHEN valid = 0 THEN 1 ELSE 0 END)                        AS invalidCount,
           COUNT(DISTINCT userId)                                            AS accountCount,
           COUNT(DISTINCT deviceHash)                                        AS deviceCount,
           COUNT(DISTINCT projectId)                                         AS projectCount,
           MAX(riskScore)                                                    AS maxRiskScore,
           MAX(createdAt)                                                    AS latestAt
    FROM   Vote
    WHERE  ${whereSql}
    GROUP  BY ${Prisma.raw(col)}
    ${havingSql}
    ORDER  BY maxRiskScore DESC, voteCount DESC
    LIMIT  ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);

  const totalRows = await prisma.$queryRaw<Array<{ cnt: number | bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS cnt
    FROM   (SELECT 1 FROM Vote WHERE ${whereSql} GROUP BY ${Prisma.raw(col)}) t
  `);

  const items: RiskGroupDTO[] = rows.map((row) => {
    const key = row.key;
    const maxRiskScore = Number(row.maxRiskScore ?? 0);
    return {
      key,
      display: group === 'device' && key.length > 24 ? `${key.slice(0, 24)}…` : key,
      voteCount: Number(row.voteCount ?? 0),
      validCount: Number(row.validCount ?? 0),
      invalidCount: Number(row.invalidCount ?? 0),
      accountCount: Number(row.accountCount ?? 0),
      deviceCount: Number(row.deviceCount ?? 0),
      projectCount: Number(row.projectCount ?? 0),
      maxRiskScore,
      riskLevel: riskLevelOf(maxRiskScore),
      latestAt: toIsoString(row.latestAt),
    };
  });

  return { items, page, pageSize, total: Number(totalRows[0]?.cnt ?? 0) };
}

/**
 * 审计汇总（风控页聚合卡片数据源）：可疑分组数 / 高危分组数 / 可疑票数 / 累计作废票数。
 * 与 auditGroups 同口径（同 group + campaign 过滤）。
 */
export async function auditSummary(query: Pick<RiskAuditQuery, 'group' | 'campaignId'>): Promise<RiskSummary> {
  const group = normalizeGroup(query.group ?? 'ip');
  const col = GROUP_COL[group];
  const campaignId = normalizeCampaignId(query.campaignId);
  const whereSql = groupWhereSql(col, campaignId);

  const [groupRows, voteRows] = await Promise.all([
    prisma.$queryRaw<Array<{ suspiciousGroups: number | bigint; highGroups: number | bigint }>>(Prisma.sql`
      SELECT
        SUM(CASE WHEN m >= ${RISK_SUSPICIOUS_THRESHOLD} THEN 1 ELSE 0 END) AS suspiciousGroups,
        SUM(CASE WHEN m >= ${RISK_HIGH_THRESHOLD} THEN 1 ELSE 0 END)       AS highGroups
      FROM   (SELECT MAX(riskScore) AS m FROM Vote WHERE ${whereSql} GROUP BY ${Prisma.raw(col)}) t
    `),
    prisma.$queryRaw<Array<{ suspiciousVotes: number | bigint; invalidVotes: number | bigint }>>(Prisma.sql`
      SELECT
        COUNT(*)                             AS suspiciousVotes,
        SUM(CASE WHEN valid = 0 THEN 1 ELSE 0 END) AS invalidVotes
      FROM   Vote
      WHERE  riskScore >= ${RISK_SUSPICIOUS_THRESHOLD}${campaignId ? Prisma.sql` AND campaignId = ${campaignId}` : Prisma.empty}
    `),
  ]);

  return {
    suspiciousGroups: Number(groupRows[0]?.suspiciousGroups ?? 0),
    highGroups: Number(groupRows[0]?.highGroups ?? 0),
    suspiciousVotes: Number(voteRows[0]?.suspiciousVotes ?? 0),
    invalidVotes: Number(voteRows[0]?.invalidVotes ?? 0),
  };
}

/**
 * 可疑票明细（docs/P2-风控模块设计.md §1.6）：按 group+key 过滤，join project/user，
 * 分页；出 RiskVoteDTO[]。
 */
export async function auditDetail(query: RiskDetailQuery): Promise<PagedResult<RiskVoteDTO>> {
  const group = normalizeGroup(query.group ?? 'ip');
  const col = GROUP_COL[group];
  const key = query.key?.trim() ?? '';
  if (key === '') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '缺少 key 参数');
  }
  const campaignId = normalizeCampaignId(query.campaignId);
  const { page, pageSize } = normalizeAdminPaging(query.page, query.pageSize);

  const where = {
    [col]: key,
    ...(campaignId ? { campaignId } : {}),
  } as Prisma.VoteWhereInput;

  const [total, rows] = await Promise.all([
    prisma.vote.count({ where }),
    prisma.vote.findMany({
      where,
      include: {
        project: { select: { slug: true, title: true } },
        user: { select: { nickname: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items: RiskVoteDTO[] = rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    slug: row.project.slug,
    title: row.project.title,
    userId: row.userId,
    nickname: row.user.nickname,
    campaignId: row.campaignId,
    valid: row.valid,
    invalidReason: row.invalidReason,
    ip: row.ip,
    deviceHash: row.deviceHash,
    dwellMs: row.dwellMs,
    riskScore: row.riskScore,
    createdAt: row.createdAt.toISOString(),
  }));

  return { items, page, pageSize, total };
}

/* ============================================================================
   2) 批量作废 + 榜单重算（单个交互事务）
   ========================================================================== */

/**
 * 批量作废（docs/P2-风控模块设计.md §1.7）。
 *
 * 两种模式（二选一）：
 *   - `voteIds`：精确作废指定票（已作废跳过 / 不存在跳过，幂等）；
 *   - `scope`：作废 `ip=value` 或 `deviceHash=value` 的全部有效票，
 *     可选 `campaignId` 限定「只作废某活动内的票」。
 *
 * 事务：作废 → 受影响作品 voteCount 全量重算（COUNT(valid=true)，自愈历史漂移）→
 * voteInvalid 累加本次新作废数 → writeAudit(admin.votes.invalidate, targetId=batch:{uuid})。
 * 作废不删行（保留审计证据），同一 (projectId,userId) 因唯一约束不可重投（Q5）。
 */
export async function invalidate(input: InvalidateInput, actor: { userId: string }): Promise<InvalidateResult> {
  const hasIds = Array.isArray(input.voteIds) && input.voteIds.length > 0;
  const hasScope =
    input.scope != null &&
    (input.scope.type === 'ip' || input.scope.type === 'device') &&
    typeof input.scope.value === 'string' &&
    input.scope.value.trim() !== '';

  if (hasIds === hasScope) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, 'voteIds 与 scope 必须二选一');
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason === '') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请填写作废原因');
  }
  if (reason.length > RISK_REASON_MAX_LEN) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, `作废原因不能超过 ${RISK_REASON_MAX_LEN} 个字符`);
  }
  if (hasIds && input.voteIds!.length > ADMIN_BATCH_MAX_IDS) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, `单次作废最多 ${ADMIN_BATCH_MAX_IDS} 票`);
  }

  const campaignId = normalizeCampaignId(input.campaignId);
  const batchId = randomUUID();

  // 取受影响的有效票（已作废 / 不存在的自动跳过，保证幂等）
  const affected = hasIds
    ? await prisma.vote.findMany({
        where: { id: { in: input.voteIds! }, valid: true },
        select: { id: true, projectId: true },
      })
    : await prisma.vote.findMany({
        where: {
          valid: true,
          ...(input.scope!.type === 'ip' ? { ip: input.scope!.value.trim() } : { deviceHash: input.scope!.value.trim() }),
          ...(campaignId ? { campaignId } : {}),
        },
        select: { id: true, projectId: true },
      });

  const affectedIds = affected.map((vote) => vote.id);
  if (affectedIds.length === 0) {
    console.log(`[risk][invalidate] batch=${batchId} invalidated=0 affected=0 scope=${hasScope ? `${input.scope!.type}:${input.scope!.value}` : 'voteIds'}`);
    return { invalidated: 0, affectedProjects: [], batchId, reason };
  }

  const affectedProjects = [...new Set(affected.map((vote) => vote.projectId))];

  await prisma.$transaction(async (tx) => {
    await tx.vote.updateMany({
      where: { id: { in: affectedIds } },
      data: { valid: false, invalidReason: reason },
    });

    for (const projectId of affectedProjects) {
      const newCount = await tx.vote.count({ where: { projectId, valid: true } });
      const newlyInvalid = affected.filter((vote) => vote.projectId === projectId).length;
      await tx.projectStats.upsert({
        where: { projectId },
        update: { voteCount: newCount, voteInvalid: { increment: newlyInvalid } },
        create: { projectId, voteCount: newCount, voteInvalid: newlyInvalid },
      });
    }
  });

  await writeAudit({
    actorId: actor.userId,
    action: AUDIT_ACTION.VOTES_INVALIDATE,
    targetType: 'vote',
    targetId: `batch:${batchId}`,
    detail: `批量作废 ${affectedIds.length} 票（涉及 ${affectedProjects.length} 件作品）：${reason}`,
    meta: {
      count: affectedIds.length,
      reason,
      ...(hasIds ? { voteIds: input.voteIds! } : { scope: input.scope! }),
      ...(campaignId ? { campaignId } : {}),
      affectedProjects,
    },
  });

  console.log(
    `[risk][invalidate] batch=${batchId} invalidated=${affectedIds.length} projects=${affectedProjects.length} scope=${hasScope ? `${input.scope!.type}:${input.scope!.value}` : 'voteIds'}`,
  );

  return { invalidated: affectedIds.length, affectedProjects, batchId, reason };
}
