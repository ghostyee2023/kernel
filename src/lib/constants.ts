/**
 * 全站魔法值收口。
 *
 * SQLite 无原生 enum，取值以 `as const` 常量对象 + 联合类型表达，
 * 字符串字面量与 docs/03 的 enum 成员**逐字一致**，保证切 Postgres 时数据零转换。
 *
 * 设计真源：docs/P0-架构与任务分解.md §7.2 / §7.3 / §7.5 / §7.6
 */

/* ============================================================================
   1) 枚举常量
   ========================================================================== */

/** 用户角色。 */
export const ROLE = {
  USER: 'USER',
  JUDGE: 'JUDGE',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

/** 角色中文名（P3.5 概览/设置角色徽章，全 token 无硬编码文案散落）。 */
export const ROLE_LABEL: Record<Role, string> = {
  USER: '创作者',
  JUDGE: '评委',
  ADMIN: '管理员',
  SUPER_ADMIN: '超级管理员',
};

/** 取角色中文名；未知角色原样返回（防御性兜底）。 */
export function roleLabel(role: string | null | undefined): string {
  return role ? (ROLE_LABEL[role as Role] ?? role) : '创作者';
}

/** 用户状态。 */
export const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  BANNED: 'BANNED',
} as const;
export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

/** 作品来源类型。 */
export const SOURCE_TYPE = {
  SINGLE_FILE: 'SINGLE_FILE',
  ZIP: 'ZIP',
  EXTERNAL_URL: 'EXTERNAL_URL',
} as const;
export type SourceType = (typeof SOURCE_TYPE)[keyof typeof SOURCE_TYPE];

/** 作品可见性。P0 行为：PUBLIC 进广场 / UNLISTED 链接可达 / PRIVATE 一律 404。 */
export const VISIBILITY = {
  PUBLIC: 'PUBLIC',
  UNLISTED: 'UNLISTED',
  PRIVATE: 'PRIVATE',
} as const;
export type Visibility = (typeof VISIBILITY)[keyof typeof VISIBILITY];

/** 作品生命周期状态。 */
export const PROJECT_STATUS = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
  PURGED: 'PURGED',
  BLOCKED: 'BLOCKED',
} as const;
export type ProjectStatus = (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS];

/** 清理任务动作。 */
export const CLEANUP_ACTION = {
  ARCHIVE: 'archive',
  PURGE: 'purge',
  TMP_GC: 'tmp-gc',
  ORPHAN_SCAN: 'orphan-scan',
  NOTIFY: 'notify',
} as const;
export type CleanupAction = (typeof CLEANUP_ACTION)[keyof typeof CLEANUP_ACTION];

/** 活动状态（P1 活动模块）。SQLite 无 enum，用 String + 常量表达。 */
export const CAMPAIGN_STATUS = {
  DRAFT: 'draft',
  COLLECTING: 'collecting',
  VOTING: 'voting',
  ENDED: 'ended',
} as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUS)[keyof typeof CAMPAIGN_STATUS];

/** 活动报名状态。 */
export const PROJECT_CAMPAIGN_STATUS = {
  JOINED: 'joined',
  REJECTED: 'rejected',
  REMOVED: 'removed',
} as const;
export type ProjectCampaignStatus = (typeof PROJECT_CAMPAIGN_STATUS)[keyof typeof PROJECT_CAMPAIGN_STATUS];

/** P1 补：活动类型（ONLINE 默认，OFFLINE 线下）。 */
export const ACTIVITY_TYPE = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
} as const;
export type ActivityType = (typeof ACTIVITY_TYPE)[keyof typeof ACTIVITY_TYPE];
/** 活动类型展示文案。 */
export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  [ACTIVITY_TYPE.ONLINE]: '线上',
  [ACTIVITY_TYPE.OFFLINE]: '线下',
};

/** 个人空间 Tab（P3）。URL 参数 `?tab=` 收口取值，非法值回落 published（§1.6）。 */
export const DASHBOARD_TAB = {
  PUBLISHED: 'published',
  JOINED: 'joined',
  FAVORITES: 'favorites',
  /** P3 补：我的投票。 */
  MY_VOTES: 'myvotes',
} as const;
export type DashboardTab = (typeof DASHBOARD_TAB)[keyof typeof DASHBOARD_TAB];

/** 个人后台页（P3.5）。URL 参数 `?page=` 收口取值，非法/缺省回落 overview（§1.3 / §7.1）。 */
export const DASHBOARD_PAGE = {
  OVERVIEW: 'overview',
  MY_PROJECTS: 'myprojects',
  MY_VOTES: 'myvotes',
  SETTINGS: 'settings',
  FAVORITES: 'favorites',
} as const;
export type DashboardPage = (typeof DASHBOARD_PAGE)[keyof typeof DASHBOARD_PAGE];

/**
 * 审计动作命名（P2 后台模块）。全小写 + 点分。
 *
 * 规范（docs/P2-后台管理设计.md §7.2）：
 *   admin.{domain}.{action} —— 管理员后台发起的写操作；
 *   非后台领域动作（未来 vote.invalidate 等）沿用 `{domain}.{action}` 风格，
 *   与 `admin.` 前缀区分「谁发起的」。
 */
export const AUDIT_ACTION = {
  PROJECT_BLOCK: 'admin.project.block',
  PROJECT_UNBLOCK: 'admin.project.unblock',
  PROJECT_PURGE: 'admin.project.purge',
  PROJECT_RENEW: 'admin.project.renew',
  PROJECT_VISIBILITY: 'admin.project.visibility',
  PROJECT_PIN: 'admin.project.pin',
  PROJECT_UNPIN: 'admin.project.unpin',
  USER_BAN: 'admin.user.ban',
  USER_UNBAN: 'admin.user.unban',
  CLEANUP_RUN: 'admin.cleanup.run',
  CAMPAIGN_CREATE: 'admin.campaign.create',
  CAMPAIGN_UPDATE: 'admin.campaign.update',
  CAMPAIGN_REMOVE_PROJECT: 'admin.campaign.remove-project',
  VOTES_INVALIDATE: 'admin.votes.invalidate',
  /** P3.5 改密码（非后台领域动作，`{domain}.{action}` 风格区分发起方）。 */
  PASSWORD_CHANGED: 'auth.user.password-changed',
} as const;
export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

/** P2 补：审计动作中文标签（审计日志页展示）。 */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  [AUDIT_ACTION.PROJECT_BLOCK]: '屏蔽作品',
  [AUDIT_ACTION.PROJECT_UNBLOCK]: '解除屏蔽',
  [AUDIT_ACTION.PROJECT_PURGE]: '永久删除作品',
  [AUDIT_ACTION.PROJECT_RENEW]: '续期作品',
  [AUDIT_ACTION.PROJECT_VISIBILITY]: '修改可见性',
  [AUDIT_ACTION.PROJECT_PIN]: '置顶作品',
  [AUDIT_ACTION.PROJECT_UNPIN]: '取消置顶',
  [AUDIT_ACTION.USER_BAN]: '封禁用户',
  [AUDIT_ACTION.USER_UNBAN]: '解封用户',
  [AUDIT_ACTION.CLEANUP_RUN]: '运行清理',
  [AUDIT_ACTION.CAMPAIGN_CREATE]: '创建活动',
  [AUDIT_ACTION.CAMPAIGN_UPDATE]: '更新活动',
  [AUDIT_ACTION.CAMPAIGN_REMOVE_PROJECT]: '移除活动作品',
  [AUDIT_ACTION.VOTES_INVALIDATE]: '批量作废票',
  [AUDIT_ACTION.PASSWORD_CHANGED]: '修改密码',
};

/** 上传模式（与 SOURCE_TYPE 一一对应，供上传会话使用）。 */
export const UPLOAD_MODE = {
  ZIP: 'ZIP',
  SINGLE_FILE: 'SINGLE_FILE',
  EXTERNAL_URL: 'EXTERNAL_URL',
} as const;
export type UploadMode = (typeof UPLOAD_MODE)[keyof typeof UPLOAD_MODE];

/* ============================================================================
   2) 环境变量读取（集中一处，避免散落 process.env）
   ========================================================================== */

/** 读取字符串型环境变量，缺失时回落默认值。 */
function envStr(key: string, fallback: string): string {
  const raw = process.env[key];
  return raw === undefined || raw === '' ? fallback : raw;
}

/** 读取整数型环境变量，非法时回落默认值。 */
function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 读取布尔型环境变量（`'true'` / `'1'` 视为真）。 */
function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

/** 本地存储根目录（相对项目根或绝对路径）。⬆️ 生产为 `/data` 或 S3 配置。 */
export const KERNEL_DATA_DIR: string = envStr('KERNEL_DATA_DIR', './.kernel-data');

/** 主站根地址，用于拼接 detailUrl / sandboxUrl。 */
export const SITE_URL: string = envStr('SITE_URL', 'http://localhost:3000').replace(/\/+$/, '');

/** 沙箱模式：`subpath`（本地）/ `subdomain`（生产）。 */
export const SANDBOX_MODE: 'subpath' | 'subdomain' =
  envStr('SANDBOX_MODE', 'subpath') === 'subdomain' ? 'subdomain' : 'subpath';

/** 沙箱子路径前缀（仅 subpath 模式生效）。 */
export const SANDBOX_BASE_PATH: string = envStr('SANDBOX_BASE_PATH', '/sandbox').replace(/\/+$/, '');

/** 沙箱独立域名（仅 subdomain 模式生效）。 */
export const SANDBOX_DOMAIN: string = envStr('SANDBOX_DOMAIN', 'demo-sandbox.com');

/** 是否下发 CSP `sandbox` 指令。关闭后作品可用 localStorage，但隔离降级。 */
export const SANDBOX_CSP_STRICT: boolean = envBool('SANDBOX_CSP_STRICT', true);

/** 默认保留时长（天）。 */
export const DEFAULT_TTL_DAYS: number = envInt('DEFAULT_TTL_DAYS', 90);

/** 归档后进入回收站的天数，到期物理删除。 */
export const RECYCLE_BIN_DAYS: number = envInt('RECYCLE_BIN_DAYS', 30);

/** 管理端清理接口的令牌。兼容 `ADMIN_CLEANUP_TOKEN` 与设计文档中的 `ADMIN_TOKEN`。 */
export const ADMIN_TOKEN: string = envStr('ADMIN_CLEANUP_TOKEN', envStr('ADMIN_TOKEN', 'dev-only-token'));

/**
 * Vercel Cron 调度端点鉴权密钥（/api/cron/run）。
 * 本地默认 `dev-cron-secret`；生产 Vercel 平台配随机强值。
 */
export const CRON_SECRET: string = envStr('CRON_SECRET', 'dev-cron-secret');

/* ============================================================================
   3) 限额
   ========================================================================== */

/** 1 MB 的字节数。 */
export const BYTES_PER_MB = 1024 * 1024;

/** 1 GB 的字节数（P3.5 存储面板口径，`BYTES_PER_GB = 1024^3`）。 */
export const BYTES_PER_GB = 1024 * 1024 * 1024;

/** 个人存储配额：5 GB（P3.5 概览存储面板，纯展示不拦截发布，Q4）。 */
export const STORAGE_QUOTA_BYTES = 5 * BYTES_PER_GB;

/** 密码最短长度（P3.5 改密码，前端 + 后端双重校验）。 */
export const MIN_PASSWORD_LEN = 6;

/** 单文件上传上限（字节）。 */
export const MAX_UPLOAD_BYTES: number = envInt('MAX_UPLOAD_MB', 100) * BYTES_PER_MB;

/** 解压后总体积上限（字节）。 */
export const MAX_EXTRACTED_BYTES: number = envInt('MAX_EXTRACTED_MB', 200) * BYTES_PER_MB;

/** ZIP 条目数上限。 */
export const MAX_ZIP_ENTRIES: number = envInt('MAX_ZIP_ENTRIES', 2000);

/** ZIP 解压比上限（解压后 / 压缩包体积）。 */
export const MAX_ZIP_RATIO: number = envInt('MAX_ZIP_RATIO', 100);

/** 单张作品截图上限（字节）。 */
export const MAX_SCREENSHOT_BYTES: number = envInt('MAX_SCREENSHOT_MB', 5) * BYTES_PER_MB;

/** 作品截图最多张数。 */
export const MAX_SCREENSHOTS = 9;

/** 截图允许的真实图片类型（magic number 识别，见 detectImageType）。 */
export const SCREENSHOT_EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;

/** ZIP 单条目解压后体积上限（字节）。 */
export const MAX_ZIP_ENTRY_BYTES: number = 50 * BYTES_PER_MB;

/** 分片大小，固定 5MB。文件 ≤5MB 时 totalChunks = 1，走同一套契约。 */
export const CHUNK_SIZE: number = 5 * BYTES_PER_MB;

/**
 * 生产分片大小：Vercel Function 请求体上限 4.5MB，取 3MB 留余量（Q5 已拍板）。
 * 仅 `NODE_ENV=production` 时由 session.init 使用；本地保持 CHUNK_SIZE。
 */
export const CHUNK_SIZE_PRODUCTION: number = 3 * BYTES_PER_MB;

/** 生产模式判定（分片大小 / 进程内 cron 守卫等共用）。 */
export function isProductionMode(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** 上传会话有效期（毫秒），超时由 tmp-gc 回收。 */
export const UPLOAD_SESSION_TTL_MS: number = 2 * 60 * 60 * 1000;

/** 单批生命周期任务处理条数。 */
export const CLEANUP_BATCH_SIZE = 200;

/* ============================================================================
   4) 文本长度与业务档位
   ========================================================================== */

/** 标题最大长度。 */
export const MAX_TITLE_LEN = 60;
/** 简介最大长度。 */
export const MAX_SUMMARY_LEN = 200;
/** 详细说明最大长度。 */
export const MAX_DESCRIPTION_LEN = 5000;
/** 署名最大长度。 */
export const MAX_AUTHOR_ALIAS_LEN = 24;

/** 活动标题最大长度（P1 活动模块）。 */
export const MAX_CAMPAIGN_TITLE_LEN = 60;
/** 活动简介最大长度。 */
export const MAX_CAMPAIGN_DESCRIPTION_LEN = 2000;

/** 活动默认每人限票数。 */
export const DEFAULT_MAX_VOTES_PER_USER = 3;
/** 活动默认是否允许自投。 */
export const DEFAULT_ALLOW_SELF_VOTE = true;
/** 活动默认评委加权（本轮恒 1）。 */
export const DEFAULT_VOTE_WEIGHT = 1;

/** 活动每人限票可选档位（后台表单用）。 */
export const MAX_VOTES_OPTIONS: readonly number[] = [1, 3, 5] as const;

/** 活动榜默认条数。 */
export const CAMPAIGN_RANK_PAGE_LIMIT = 12;

/** 可选保留时长档位（天）。 */
export const TTL_OPTIONS: readonly number[] = [7, 30, 90, 180, 365] as const;

/** 广场分页默认条数。 */
export const DEFAULT_PAGE_SIZE = 12;
/** 广场分页上限。 */
export const MAX_PAGE_SIZE = 48;

/** 后台列表分页默认条数（Q2：后台默认 20；广场仍 12/48 不变）。 */
export const ADMIN_DEFAULT_PAGE_SIZE = 20;
/** 后台列表分页上限。 */
export const ADMIN_MAX_PAGE_SIZE = 100;
/** 后台批量操作单次最大条数。 */
export const ADMIN_BATCH_MAX_IDS = 100;

/** 「即将过期」徽章的阈值（天）。 */
export const EXPIRING_SOON_DAYS = 7;

/* ============================================================================
   5.5) 风控阈值（P2 风控模块，docs/P2-风控模块设计.md §7.1 收口）
   ========================================================================== */

/** riskScore ≥ 30 → suspect（审计默认可疑口径）。 */
export const RISK_SUSPICIOUS_THRESHOLD = 30;
/** riskScore ≥ 60 → high（高危分组卡片口径）。 */
export const RISK_HIGH_THRESHOLD = 60;
/** 规则求和封顶。 */
export const RISK_MAX_SCORE = 100;
/** P2 补：用户风险分 ≥ 该值 → 自动封禁（riskLevel 联动，vote 实时触发）。 */
export const RISK_BAN_THRESHOLD = 100;
/** 同 IP 高频窗口（1 分钟）。 */
export const RISK_IP_HIGH_FREQ_WINDOW_MS = 60_000;
/** 窗口内票数 ≥ 5 触发。 */
export const RISK_IP_HIGH_FREQ_THRESHOLD = 5;
/** 同 IP 去重账号 ≥ 3 触发。 */
export const RISK_IP_MULTI_ACCOUNT_THRESHOLD = 3;
/** 同设备去重账号 ≥ 3 触发。 */
export const RISK_DEVICE_MULTI_ACCOUNT_THRESHOLD = 3;
/** 秒级连投相邻间隔 ≤ 3s。 */
export const RISK_RAPID_GAP_MS = 3_000;
/** 连续 ≥ 3 条触发。 */
export const RISK_RAPID_COUNT = 3;
/** 作废原因上限。 */
export const RISK_REASON_MAX_LEN = 200;

/** 各规则得分（docs/P2-风控模块设计.md §1.4 表内嵌，收口常量便于调整）。 */
export const RISK_IP_HIGH_FREQ_SCORE = 30;
export const RISK_IP_MULTI_ACCOUNT_SCORE = 25;
export const RISK_DEVICE_MULTI_ACCOUNT_SCORE = 35;
export const RISK_RAPID_CONSECUTIVE_SCORE = 20;

/** 风险规则代码（SQLite 无 enum，用 String 常量 + 联合类型表达）。 */
export const RISK_RULE_CODE = {
  IP_HIGH_FREQ: 'IP_HIGH_FREQ',
  IP_MULTI_ACCOUNT: 'IP_MULTI_ACCOUNT',
  DEVICE_MULTI_ACCOUNT: 'DEVICE_MULTI_ACCOUNT',
  RAPID_CONSECUTIVE: 'RAPID_CONSECUTIVE',
} as const;
export type RiskRuleCode = (typeof RISK_RULE_CODE)[keyof typeof RISK_RULE_CODE];

/** 风险等级（normal / suspect / high）。 */
export type RiskLevel = 'normal' | 'suspect' | 'high';

/** P0 占位用户 id，所有作品挂在其名下。 */
export const LOCAL_DEMO_USER_ID = 'local-demo-user';

/* ============================================================================
   5) 短码规则
   ========================================================================== */

/** Base58 字符集（去掉易混淆的 `0 O I l`）。 */
export const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** 短码长度。 */
export const SLUG_LENGTH = 8;

/** 短码冲突时的最大重试次数。 */
export const SLUG_MAX_RETRY = 3;

/** 保留短码（命中则重新生成；自定义短码直接拒绝）。 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api',
  'admin',
  'www',
  'static',
  'og',
  'p',
  'w',
  'new',
  'sandbox',
  '_status',
  '_next',
  'rank',
  'c',
  'me',
  'login',
  'register',
  'health',
  'favicon',
  'assets',
  'public',
  'robots',
  'sitemap',
]);

/** 自定义短码格式（3–32 位，首尾为字母数字）。P0 仅作校验保留，UI 不暴露。 */
export const CUSTOM_SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,30}[a-zA-Z0-9]$/;

/** 活动 slug 格式（P1 活动模块）：小写字母/数字开头，2–32 位，仅小写字母/数字/连字符。 */
export const CAMPAIGN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** 活动 slug 自动生成前缀：`camp-{Base58 6位}`。 */
export const CAMPAIGN_SLUG_PREFIX = 'camp-';
/** 活动 slug 自动生成随机段长度。 */
export const CAMPAIGN_SLUG_RANDOM_LEN = 6;

/* ============================================================================
   6) 文件白名单
   ========================================================================== */

/** 允许落盘的文件扩展名（不含点，小写）。不在名单内的条目会被静默忽略并透明告知用户。 */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  // 文档
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'json',
  'txt',
  'md',
  'xml',
  'csv',
  'map',
  'pdf',
  // 图像
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'ico',
  'bmp',
  // 字体
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  // 音视频
  'mp4',
  'webm',
  'mp3',
  'wav',
  'ogg',
  // 其他运行时资源
  'wasm',
  'glb',
  'gltf',
]);

/** 入口文件候选，按优先级排序。 */
export const ENTRY_FILE_CANDIDATES: readonly string[] = ['index.html', 'index.htm', 'main.html', 'home.html'] as const;

/** ZIP 内应整体忽略的目录段（大小写不敏感）。 */
export const IGNORED_DIR_SEGMENTS: ReadonlySet<string> = new Set([
  '__macosx',
  '.git',
  '.svn',
  '.hg',
  '.idea',
  '.vscode',
  'node_modules',
  '.kernel',
]);

/** ZIP 内应忽略的文件名（大小写不敏感）。 */
export const IGNORED_FILE_NAMES: ReadonlySet<string> = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

/** 平台元数据目录名，沙箱路由对其硬拒。 */
export const KERNEL_META_DIR = '.kernel';

/** 平台元数据文件名。 */
export const KERNEL_META_FILE = 'meta.json';

/** 磁盘元数据版本标记。 */
export const KERNEL_VERSION = 'p0';
