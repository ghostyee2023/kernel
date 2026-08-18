/**
 * 领域 DTO 与共享类型。
 *
 * 约定：所有跨越 API 边界的时间字段一律为 **ISO 8601 UTC 字符串**，
 * 不下发 Date 对象，避免 Server / Client 序列化差异。
 */

import type {
  AuditAction,
  CampaignStatus,
  CleanupAction,
  ProjectStatus,
  RiskLevel,
  SourceType,
  UploadMode,
  Visibility,
} from './constants';

/* ============================================================================
   作品
   ========================================================================== */

/** 作品对外 DTO。 */
export interface ProjectDTO {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  coverUrl: string | null;
  sourceType: SourceType;
  externalUrl: string | null;
  entryFile: string;
  fileCount: number;
  sizeBytes: number;
  visibility: Visibility;
  status: ProjectStatus;
  ttlDays: number;
  /** ISO 8601 UTC */
  expireAt: string;
  /** ISO 8601 UTC，未归档为 null */
  archivedAt: string | null;
  /** ISO 8601 UTC，未归档为 null */
  purgeAt: string | null;
  authorAlias: string | null;
  /** 作者用户 id（前端用于判断 owner 权限）。 */
  authorId: string;
  authorName: string;
  viewCount: number;
  voteCount: number;
  /** P3 补：收藏数（Favorite 表实时 count；列表/详情按需填充）。 */
  favoriteCount: number;
  /** ISO 8601 UTC */
  createdAt: string;
  /** ISO 8601 UTC */
  updatedAt: string;
  /** 沙箱直出地址 */
  sandboxUrl: string;
  /** 站内详情页地址 */
  detailUrl: string;
  /** 是否置顶（后台管理 P2 新增；广场列表 pinned 优先排序）。 */
  pinned: boolean;
}

/** 分页结果包装。 */
export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** 广场列表查询参数。 */
export interface ProjectListQuery {
  /** `new` 按发布时间 / `hot` 按热度（P1 未实现，UI 置灰）/ `votes` 按票数。 */
  sort?: 'new' | 'hot' | 'votes';
  /** 关键词，命中 title / summary。 */
  q?: string;
  /** 活动 slug 过滤（P1 活动模块）：只返回报名了该活动（joined）的作品。 */
  campaign?: string;
  page?: number;
  pageSize?: number;
}

/** 创建作品入参。 */
export interface CreateProjectInput {
  /** 上传会话 id（ZIP / 单文件模式必填）。 */
  uploadId?: string;
  /** 外链地址（EXTERNAL_URL 模式必填）。 */
  externalUrl?: string;
  title: string;
  summary?: string;
  description?: string;
  visibility?: Visibility;
  ttlDays?: number;
  /** 用户手动指定的入口文件（相对路径）。 */
  entryFile?: string;
  authorAlias?: string;
  /**
   * 作者用户 id。
   *
   * ⚠️ 该字段**只能由 Route Handler 从登录会话注入**，绝不接受请求体里的值；
   * 缺省时回落本地演示用户（`ensureLocalUser()`，P0 无登录兼容路径）。
   */
  authorId?: string;
}

/** 创建作品出参。 */
export interface CreateProjectResult {
  slug: string;
  sandboxUrl: string;
  detailUrl: string;
  /** ISO 8601 UTC */
  expireAt: string;
  /** 磁盘目录（本地桩用于透明展示）⬆️ 生产不下发 */
  dirPath: string;
}

/** 编辑作品入参。slug / sourceType 不可变更。 */
export interface PatchProjectInput {
  title?: string;
  summary?: string | null;
  description?: string | null;
  visibility?: Visibility;
  authorAlias?: string | null;
}

/* ============================================================================
   上传
   ========================================================================== */

/** 上传会话状态。 */
export type UploadSessionStatus = 'INIT' | 'UPLOADING' | 'MERGED' | 'VALIDATED' | 'COMMITTED';

/** 上传会话元数据，持久化在 `tmp/{uploadId}/session.json`。 */
export interface UploadSession {
  uploadId: string;
  fileName: string;
  fileSize: number;
  mode: UploadMode;
  chunkSize: number;
  totalChunks: number;
  /** 已成功写入的分片序号（升序去重）。 */
  receivedChunks: number[];
  status: UploadSessionStatus;
  /** ISO 8601 UTC */
  createdAt: string;
  /** ISO 8601 UTC */
  expiresAt: string;
  /** 校验通过后写入，供 POST /api/projects 复用 */
  validated?: ValidatedUpload;
}

/** upload-init 出参。 */
export interface UploadInitResult {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  /** ISO 8601 UTC */
  expiresAt: string;
}

/** upload-chunk 出参。 */
export interface UploadChunkResult {
  uploadId: string;
  received: number;
  total: number;
}

/** 文件树节点。 */
export interface FileNode {
  /** 相对项目根的 POSIX 路径 */
  path: string;
  /** 展示用的文件名 */
  name: string;
  size: number;
  /** 是否为目录 */
  dir: boolean;
  children?: FileNode[];
}

/** 被忽略的条目及原因。 */
export interface IgnoredEntry {
  path: string;
  reason: 'EXTENSION_NOT_ALLOWED' | 'IGNORED_DIRECTORY' | 'IGNORED_FILE' | 'EMPTY_PATH' | 'SYMLINK';
}

/** ZIP 预扫描结果（尚未解压）。 */
export interface ZipScanResult {
  /** 通过白名单的条目数 */
  entryCount: number;
  /** 通过白名单条目的解压后总字节 */
  totalUncompressed: number;
  /** 压缩包自身字节 */
  compressedSize: number;
  /** 解压比 = totalUncompressed / compressedSize */
  ratio: number;
  /** 允许落盘的条目相对路径 */
  acceptedPaths: string[];
  /** 被忽略的条目 */
  ignored: IgnoredEntry[];
}

/** 安全解压结果。 */
export interface ExtractResult {
  fileCount: number;
  sizeBytes: number;
  files: Array<{ path: string; size: number }>;
  ignored: IgnoredEntry[];
}

/** upload-complete 出参，也持久化进 session.validated。 */
export interface ValidatedUpload {
  uploadId: string;
  mode: UploadMode;
  fileCount: number;
  sizeBytes: number;
  entryFileSuggested: string;
  fileTree: FileNode[];
  ignoredFiles: IgnoredEntry[];
  warnings: string[];
}

/* ============================================================================
   存储 / 生命周期
   ========================================================================== */

/** 磁盘侧自描述元数据 `.kernel/meta.json`。 */
export interface ProjectMeta {
  slug: string;
  title: string;
  sourceType: SourceType;
  entryFile: string;
  fileCount: number;
  sizeBytes: number;
  /** ISO 8601 UTC */
  uploadedAt: string;
  /** ISO 8601 UTC */
  expireAt: string;
  ignoredFiles: IgnoredEntry[];
  kernelVersion: string;
}

/** 单次清理任务的汇总报告。 */
export interface CleanupReport {
  batchId: string;
  action: CleanupAction;
  scanned: number;
  affected: number;
  freedBytes: number;
  failures: number;
  /** 面向控制台的可读明细 */
  details: string[];
  durationMs: number;
}

/* ============================================================================
   API 响应
   ========================================================================== */

/** 成功响应的可选 meta。 */
export interface ResponseMeta {
  page?: number;
  pageSize?: number;
  total?: number;
  [key: string]: unknown;
}

/** 统一成功响应体。 */
export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: ResponseMeta;
}

/** 统一失败响应体。 */
export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    [key: string]: unknown;
  };
}

/** 统一响应体。 */
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/* ============================================================================
   活动 Campaign（P1 活动模块）
   ========================================================================== */

/** 活动 DTO。`status` = 懒计算 effective 状态（展示/写操作一律用它）；
 *  `storedStatus` = DB 存储的管理员设定值（后台表单回显用）。 */
export interface CampaignDTO {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  /** 懒计算的有效状态（draft/collecting/voting/ended）。 */
  status: CampaignStatus;
  /** DB 存储的管理员设定状态。 */
  storedStatus: CampaignStatus;
  /** ISO 8601 UTC，可空 */
  collectEndAt: string | null;
  /** ISO 8601 UTC，可空 */
  voteStartAt: string | null;
  /** ISO 8601 UTC，可空 */
  voteEndAt: string | null;
  maxVotesPerUser: number;
  allowSelfVote: boolean;
  voteWeight: number;
  /** P1 补：ended 后结果是否公开（false = 票数/排名对外隐藏）。 */
  resultVisible: boolean;
  /** P1 补：活动类型 ONLINE | OFFLINE。 */
  activityType: string;
  authorId: string;
  /** ISO 8601 UTC */
  createdAt: string;
  /** ISO 8601 UTC */
  updatedAt: string;
}

/** 活动卡片 DTO = CampaignDTO + 报名作品数 + 活动内累计票。 */
export interface CampaignCardDTO extends CampaignDTO {
  /** 已报名（joined）作品数。 */
  projectCount: number;
  /** 活动内票数（Vote where campaignId 的 COUNT，实时聚合）。 */
  voteCount: number;
}

/** 活动详情 DTO。 */
export interface CampaignDetailDTO extends CampaignCardDTO {
  /** 已报名作品（joined），按活动内票数 desc、joinedAt asc。 */
  projects: CampaignProjectItem[];
}

/** 活动报名作品条目。 */
export interface CampaignProjectItem {
  project: ProjectCardLite;
  /** 该作品在本活动的票数。 */
  campaignVoteCount: number;
  /** ISO 8601 UTC */
  joinedAt: string;
}

/** 活动榜条目。 */
export interface CampaignRankItemDTO {
  rank: number;
  project: ProjectCardLite;
  campaignVoteCount: number;
  /** ISO 8601 UTC */
  joinedAt: string;
}

/** 作品卡片精简 DTO（活动网格 / 活动榜用）。 */
export interface ProjectCardLite {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  coverUrl: string | null;
  authorName: string;
  /** 作者用户 id（前端用于自投开关 / 报名归属判断）。 */
  authorId: string;
  detailUrl: string;
  /** 全站票数（含活动票，ProjectStats.voteCount）。 */
  voteCount: number;
}

/** 活动报名结果。 */
export interface CampaignJoinResult {
  joined: true;
  alreadyJoined: boolean;
  /** 报名后的 joined 作品数。 */
  projectCount: number;
}

/** 活动创建 / 更新入参（时间字段为 ISO 8601 UTC 字符串）。 */
export interface CampaignInput {
  title?: string;
  description?: string | null;
  coverUrl?: string | null;
  /** 留空自动生成 `camp-{Base58 6}`（仅 create 生效）。 */
  slug?: string;
  /** ISO 8601 UTC */
  collectEndAt?: string | null;
  /** ISO 8601 UTC */
  voteStartAt?: string | null;
  /** ISO 8601 UTC */
  voteEndAt?: string | null;
  maxVotesPerUser?: number;
  allowSelfVote?: boolean;
  voteWeight?: number;
  resultVisible?: boolean;
  activityType?: string;
  status?: CampaignStatus;
}

/** 活动剩余票数信息。 */
export interface QuotaInfo {
  campaignId: string;
  slug: string;
  maxVotesPerUser: number;
  used: number;
  remaining: number;
}

/** 作品所属活动 badge（详情页 /w/[slug] 用）。 */
export interface CampaignBadgeDTO {
  id: string;
  slug: string;
  title: string;
  status: CampaignStatus;
  /** ISO 8601 UTC */
  joinedAt: string;
}

/* ============================================================================
   后台管理（P2）
   ========================================================================== */

/** 后台作品列表项：复用 ProjectDTO（含新增 pinned），不另起平行 DTO。 */
export type AdminProjectDTO = ProjectDTO;

/** 后台用户列表项。 */
export interface AdminUserDTO {
  id: string;
  username: string | null;
  nickname: string;
  role: string;
  status: string;
  /** P2 补：风控风险分（0-100+，≥60 高危，≥100 已自动封禁）。 */
  riskLevel: number;
  /** 该作者名下作品数（project.groupBy 一次取齐）。 */
  projectCount: number;
  /** ISO 8601 UTC */
  createdAt: string;
}

/** 清理日志列表项（detail 已 JSON.parse 还原为对象）。 */
export interface CleanupLogDTO {
  id: string;
  batchId: string;
  action: string;
  projectId: string | null;
  freedBytes: number;
  success: boolean;
  message: string | null;
  /** JSON.parse 后的补充信息；无 / 解析失败时为 null / 原始串。 */
  detail: unknown;
  /** ISO 8601 UTC */
  createdAt: string;
}

/** P2 补：审计日志查询入参。 */
export interface AdminAuditQuery {
  page?: number;
  pageSize?: number;
  /** 按动作过滤（如 admin.user.ban）。 */
  action?: string;
  /** 按操作者用户名模糊过滤。 */
  username?: string;
}

/** P2 补：审计日志 DTO。 */
export interface AuditLogDTO {
  id: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string | null;
  /** JSON.parse 后的结构化快照；无 / 解析失败时为 null / 原始串。 */
  meta: unknown;
  ip: string | null;
  /** ISO 8601 UTC */
  createdAt: string;
}

/** 概览指标。 */
export interface OverviewMetrics {
  projects: { total: number; active: number; archived: number; blocked: number; purged: number };
  /** ProjectStats.voteCount 全量求和。 */
  votes: number;
  users: { total: number; banned: number };
  /** Project.sizeBytes 全量求和（≈磁盘用量）。 */
  storageBytes: number;
}

/** 后台批量操作类型（单一写端点 POST /api/admin/projects/batch）。 */
export type AdminBatchOperation = 'block' | 'unblock' | 'purge' | 'renew' | 'visibility' | 'pin' | 'unpin';

/** 批量操作入参。ids 用 Project.id（cuid），1..100 条。 */
export interface AdminBatchInput {
  operation: AdminBatchOperation;
  ids: string[];
  payload?: { ttlDays?: number; visibility?: Visibility };
}

/** 批量操作单条结果。 */
export interface AdminBatchItemResult {
  id: string;
  ok: boolean;
  slug?: string;
  /** 单条失败码（NOT_FOUND / VALIDATION_FAILED ...），整单仍 200。 */
  code?: string;
  message?: string;
}

/** 批量操作出参。 */
export interface AdminBatchResult {
  operation: AdminBatchOperation;
  successCount: number;
  failCount: number;
  results: AdminBatchItemResult[];
}

/** writeAudit 入参（meta 序列化收敛在 lib/audit.ts 内）。 */
export interface AuditLogInput {
  actorId: string;
  action: AuditAction;
  /** project | user | cleanup | campaign | vote */
  targetType: 'project' | 'user' | 'cleanup' | 'campaign' | 'vote';
  /** project 用 Project.id；user 用 User.id；cleanup 用 batchId；campaign 用 Campaign.id；vote 用 `batch:{batchId}`。 */
  targetId: string;
  /** 人读摘要（中文）。 */
  detail?: string;
  /** 结构化快照 {before, after, ...} → JSON.stringify。 */
  meta?: Record<string, unknown>;
  ip?: string;
}

/* ============================================================================
   风控（P2 风控模块）
   ========================================================================== */

/** 投票入参（P1 活动模块 campaignId + P2 风控扩展，纯加法，缺省行为与现状一致）。 */
export interface VoteOptions {
  /** 归属活动 id（DB cuid）；缺省 = 全站赞，行为与既有实现完全一致。 */
  campaignId?: string;
  /** 前端设备指纹 hash（UA+canvas+salt，FNV-1a hex）。可选。 */
  deviceHash?: string;
  /** 投票前页面停留毫秒（挂载到点击的 Date.now() 差值）。可选。 */
  dwellMs?: number;
  /** 服务端解析的客户端 IP（x-forwarded-for 首值 → x-real-ip → 'unknown'）。可选。 */
  ip?: string;
}

/** 规则引擎入参的「票」：纯数据，非 Prisma 类型（保证规则函数可单测、不碰 DB）。 */
export interface RiskVoteLike {
  userId: string;
  ip?: string | null;
  deviceHash?: string | null;
  dwellMs?: number | null;
  /** 时间可注入，便于单测。 */
  createdAt: Date | string;
}

/** 单条规则命中结果。 */
export interface RiskRuleResult {
  /** RISK_RULE_CODE 成员。 */
  code: string;
  /** 该规则贡献的得分。 */
  score: number;
  /** 中文 reason（人读）。 */
  reason: string;
  /** 中文 label（规则名）。 */
  label: string;
}

/** 聚合评估结果。 */
export interface RiskVerdict {
  /** 0–100（上限 RISK_MAX_SCORE）。 */
  score: number;
  reasons: RiskRuleResult[];
  /** score >= RISK_SUSPICIOUS_THRESHOLD。 */
  suspicious: boolean;
}

/** 审计聚合分组维度。 */
export type RiskGroup = 'ip' | 'device' | 'user';

/** 审计分组 DTO。 */
export interface RiskGroupDTO {
  /** 分组键（ip / deviceHash / userId）。 */
  key: string;
  /** 展示用文本（device 截断，key 保留全量）。 */
  display: string;
  voteCount: number;
  validCount: number;
  invalidCount: number;
  accountCount: number;
  deviceCount: number;
  projectCount: number;
  maxRiskScore: number;
  riskLevel: RiskLevel;
  /** ISO 8601 UTC */
  latestAt: string;
}

/** 可疑票明细 DTO。 */
export interface RiskVoteDTO {
  id: string;
  projectId: string;
  slug: string;
  title: string;
  userId: string;
  nickname: string;
  campaignId: string | null;
  valid: boolean;
  invalidReason: string | null;
  ip: string | null;
  deviceHash: string | null;
  dwellMs: number | null;
  riskScore: number;
  /** ISO 8601 UTC */
  createdAt: string;
}

/** 审计聚合查询参数。 */
export interface RiskAuditQuery {
  group: RiskGroup;
  campaignId?: string;
  suspiciousOnly?: boolean;
  page?: number;
  pageSize?: number;
}

/** 审计明细查询参数。 */
export interface RiskDetailQuery {
  group: RiskGroup;
  /** 分组键（ip / deviceHash / userId）。 */
  key: string;
  campaignId?: string;
  page?: number;
  pageSize?: number;
}

/** 审计汇总（风控页聚合卡片）。 */
export interface RiskSummary {
  /** maxRiskScore >= 30 的分组数。 */
  suspiciousGroups: number;
  /** maxRiskScore >= 60 的分组数。 */
  highGroups: number;
  /** riskScore >= 30 的票数。 */
  suspiciousVotes: number;
  /** 累计作废（valid=false）票数。 */
  invalidVotes: number;
}

/** 批量作废入参：voteIds 与 scope 二选一。 */
export interface InvalidateInput {
  /** 精确作废指定票 id（1..ADMIN_BATCH_MAX_IDS，已作废自动跳过，幂等）。 */
  voteIds?: string[];
  /** 按 IP / 设备作废全部有效票（可加 campaignId 限定）。 */
  scope?: { type: 'ip' | 'device'; value: string };
  /** scope 模式的 campaign 限定（可选；voteIds 模式天然精确，忽略该字段）。 */
  campaignId?: string;
  /** 作废原因（必填，≤ RISK_REASON_MAX_LEN）。 */
  reason: string;
}

/** 批量作废出参。 */
export interface InvalidateResult {
  /** 实际新作废的票数（已作废/不存在的自动跳过）。 */
  invalidated: number;
  /** 受影响作品 id 列表。 */
  affectedProjects: string[];
  /** 一次作废的批次标识（AuditLog.targetId 用 `batch:{batchId}`）。 */
  batchId: string;
  reason: string;
}

/* ============================================================================
   个人空间（P3）
   ========================================================================== */

/** 收藏条目（GET /api/favorites/me，createdAt desc，对齐 /api/votes/me 形态）。 */
export interface FavoriteItem {
  projectId: string;
  /** ISO 8601 UTC */
  createdAt: string;
}

/** 个人空间计数卡聚合。口径 = 作者全部作品（含 ARCHIVED/PURGED/BLOCKED，§1.8 / §7.5）。 */
export interface MyProjectStats {
  /** 我的作品数（COUNT(Project where authorId)，含回收站/已清除）。 */
  projectCount: number;
  /** 累计票数（SUM(ProjectStats.voteCount) over 作者全部作品）。 */
  voteCount: number;
  /** 累计浏览（SUM(ProjectStats.viewCount) over 作者全部作品）。 */
  viewCount: number;
  /** 已用存储字节（SUM(Project.sizeBytes where authorId)，P3.5 存储面板口径；PURGED 已归 0 = 磁盘占用）。 */
  storageBytes: number;
}

/** 我投出的票（P3.5 我的投票左栏）——**含作废票**（valid=false + invalidReason），与 `myVotes()`（仅有效）并存。 */
export interface MyVoteFullDTO {
  id: string;
  /** 作品轻量信息（PURGED/BLOCKED/PRIVATE 由展示层做死链防护）。 */
  project: {
    id: string;
    slug: string;
    title: string;
    status: ProjectStatus;
    visibility: Visibility;
    detailUrl: string;
  };
  /** null = 全站赞。 */
  campaignId: string | null;
  /** null = 全站赞。 */
  campaignTitle: string | null;
  /** false = 被管理员作废（展示「已作废」徽章）。 */
  valid: boolean;
  invalidReason: string | null;
  /** ISO 8601 UTC */
  createdAt: string;
}

/** 我收到的票（P3.5 我的投票右栏）——有效票按 作品×活动 聚合，合计 = 概览 KPI 累计票数。 */
export interface ReceivedVoteDTO {
  projectId: string;
  slug: string;
  title: string;
  projectStatus: ProjectStatus;
  /** null = 全站赞。 */
  campaignId: string | null;
  /** null = 全站赞。 */
  campaignTitle: string | null;
  /** COUNT(valid=true) 该作品×该活动收到的有效票数。 */
  voteCount: number;
}

/** 账户设置 SSR 出参（P3.5，不透出 passwordHash，仅转布尔 hasPassword）。 */
export interface AccountInfo {
  username: string;
  nickname: string;
  /** P3 补：头像 URL（可空，空则首字母占位）。 */
  avatarUrl: string | null;
  role: string;
  /** ISO 8601 UTC */
  createdAt: string;
  hasPassword: boolean;
}

/** 我参与的活动（ProjectCampaign→Campaign 聚合，§1.4）。 */
export interface JoinedCampaignDTO {
  /** 含懒计算 status / collectEndAt / voteStartAt / voteEndAt / projectCount / voteCount。 */
  campaign: CampaignCardDTO;
  /** 我报名了该活动的作品数。 */
  myProjectCount: number;
  /** 我的作品在该活动内的票数合计（<= campaign.voteCount）。 */
  myCampaignVoteCount: number;
}
