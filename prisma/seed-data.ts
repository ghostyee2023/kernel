/**
 * 演示数据播种逻辑（供 CLI 与 Vercel Cron 自动 seed 复用）。
 *
 * 产出：
 *   1. 占位用户 `local-demo-user` / 管理员 `admin` / 风控演示用户
 *   2. 三件自制静态作品（素材见 `prisma/fixtures/`），可见性与 TTL 各不相同
 *   3. 演示活动 + 报名 + 演示收藏 + 风控演示票
 *
 * 幂等：全部 upsert，重复执行会覆盖同 slug 的 DB 记录与作品文件。
 *
 * 双后端：素材落盘走 storage 层分发（本地磁盘 / Vercel Blob），
 * 入库走传入的 PrismaClient（本地原生引擎 / Turso adapter）。
 *
 * 运行：`npm run db:seed`（CLI）；生产空库由 `/api/cron/run` 自动调用。
 */

import * as path from 'node:path';

import type { PrismaClient } from '@prisma/client';

import {
  CAMPAIGN_STATUS,
  LOCAL_DEMO_USER_ID,
  PROJECT_CAMPAIGN_STATUS,
  PROJECT_STATUS,
  ROLE,
  SOURCE_TYPE,
  USER_STATUS,
  VISIBILITY,
  type SourceType,
  type Visibility,
} from '../src/lib/constants';
import { buildCoverSvg } from '../src/lib/cover';
import { MS_PER_DAY } from '../src/lib/format';
import {
  ensureDataSkeleton,
  listProjectFiles,
  projectDirSize,
  seedProjectFromDir,
  writeCover,
  writeMeta,
} from '../src/lib/storage';
import type { ProjectMeta } from '../src/lib/types';

/**
 * 素材目录：相对 `process.cwd()` 解析（本地 CLI / next dev / Vercel Lambda 三者一致）。
 *
 * ⬆️ Vercel 试验部署：`next.config.ts` 的 `outputFileTracingIncludes` 会把
 * `prisma/fixtures/**` 按项目相对路径打进函数包，Vercel Lambda 运行时
 * `process.cwd()` 即函数根目录，因此这里能稳定命中（不依赖 `import.meta.url`，
 * 后者在打包后的 server bundle 里不可靠）。
 */
const FIXTURES_DIR = path.resolve(process.cwd(), 'prisma', 'fixtures');

/** 单条演示作品的定义。 */
interface DemoSpec {
  slug: string;
  /** `prisma/fixtures/` 下的目录名 */
  fixture: string;
  title: string;
  summary: string;
  description: string;
  sourceType: SourceType;
  visibility: Visibility;
  ttlDays: number;
  /** 相对今天的创建时间偏移（天，正数表示更早） */
  createdDaysAgo: number;
  authorAlias: string;
  viewCount: number;
  /**
   * 截图文件名（与 `public/screenshots/` 内一一对应；`/api/screenshots/[file]` 后端 miss
   * 时会兜底到这里）。文件名遵守路由白名单 `^[0-9a-f]{16}\.(jpg|png|webp|gif)$`。
   */
  screenshots: string[];
}

const DEMOS: readonly DemoSpec[] = [
  {
    slug: 'Aur9raFx',
    fixture: 'aurora-canvas',
    title: 'Aurora Field 极光粒子场',
    summary: '纯 Canvas 2D 的三色流体粒子场，鼠标可扰动流场，零依赖零构建。',
    description:
      '用两层正弦叠加构造一个缓慢演化的流场，让约 300 个粒子沿着流线漂移；\n' +
      '叠加 lighter 混合模式后自然形成极光般的层次。\n\n' +
      '技术要点：\n' +
      '· requestAnimationFrame 驱动，devicePixelRatio 自适应\n' +
      '· 粒子数量随视口面积动态伸缩，保证低端设备也能跑满 60fps\n' +
      '· 指针进入时施加反平方斥力，离开自动衰减',
    sourceType: SOURCE_TYPE.ZIP,
    visibility: VISIBILITY.PUBLIC,
    ttlDays: 90,
    createdDaysAgo: 12,
    authorAlias: '寇豆码',
    viewCount: 1284,
    screenshots: ['a1b2c3d4e5f60101.png', 'a1b2c3d4e5f60102.png', 'a1b2c3d4e5f60103.png'],
  },
  {
    slug: 'NebuLa42',
    fixture: 'nebula-landing',
    title: 'Nebula 一页式落地页',
    summary: '零构建的产品落地页骨架：clamp 流体排版 + 纯 CSS 动效，首屏 14KB。',
    description:
      '一个可以直接双击打开的产品落地页：导航、Hero、特性、数据、定价、页脚一应俱全。\n\n' +
      '设计约束：\n' +
      '· 全部字号走 clamp()，从 360px 到 2560px 无需堆断点\n' +
      '· 动效只用 transition 与 keyframes，并尊重 prefers-reduced-motion\n' +
      '· 没有任何第三方依赖，部署单元就是两个文件',
    sourceType: SOURCE_TYPE.ZIP,
    visibility: VISIBILITY.PUBLIC,
    // 25 天前创建 + 30 天 TTL → 约 5 天后过期，用于观察「即将过期」徽章
    ttlDays: 30,
    createdDaysAgo: 25,
    authorAlias: '寇豆码',
    viewCount: 763,
    screenshots: ['b2c3d4e5f6a70201.png', 'b2c3d4e5f6a70202.png', 'b2c3d4e5f6a70203.png'],
  },
  {
    slug: 'PuLse7Kd',
    fixture: 'pulse-chart',
    title: 'Pulse 部署脉搏仪表盘',
    summary: '手写 SVG 折线与条形图的深色仪表盘，确定性伪随机数据，刷新不跳变。',
    description:
      '不引入任何图表库，直接用三次贝塞尔拼出平滑折线，配合渐变填充区与网格线。\n\n' +
      '实现细节：\n' +
      '· 线性同余伪随机 + 固定种子，保证每次渲染图形一致，便于视觉回归\n' +
      '· 折线为纯 SVG path，条形图为 CSS transition 入场\n' +
      '· 深色面板配色与 Kernel 品牌三锚点保持一致\n\n' +
      '本作品设置为「不公开列出」，只能通过短链访问，用于验证 UNLISTED 行为。',
    sourceType: SOURCE_TYPE.ZIP,
    visibility: VISIBILITY.UNLISTED,
    ttlDays: 365,
    createdDaysAgo: 3,
    authorAlias: '寇豆码',
    viewCount: 208,
    screenshots: ['c3d4e5f6a7b80301.png', 'c3d4e5f6a7b80302.png', 'c3d4e5f6a7b80303.png'],
  },
];

/** 建立占位用户。 */
async function seedUser(prisma: PrismaClient): Promise<void> {
  await prisma.user.upsert({
    where: { id: LOCAL_DEMO_USER_ID },
    update: { nickname: '本地创作者', username: 'demo' },
    create: {
      id: LOCAL_DEMO_USER_ID,
      nickname: '本地创作者',
      username: 'demo',
      role: ROLE.USER,
      status: USER_STATUS.ACTIVE,
    },
  });
  console.log(`[seed][user] id=${LOCAL_DEMO_USER_ID} username=demo`);
}

/** 建立演示管理员（用户名密码展示版登录用：admin / 123456）。 */
async function seedAdmin(prisma: PrismaClient): Promise<void> {
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { nickname: '管理员', role: ROLE.ADMIN, status: USER_STATUS.ACTIVE },
    create: {
      username: 'admin',
      nickname: '管理员',
      role: ROLE.ADMIN,
      status: USER_STATUS.ACTIVE,
    },
  });
  console.log('[seed][user] username=admin role=ADMIN');
}

/**
 * 建立风控演示普通用户（P2 风控模块，Q9：多账号刷票演示）。
 * 用户名固定，重复 seed 幂等（upsert by username）。
 */
async function seedRiskUsers(prisma: PrismaClient): Promise<void> {
  const specs: Array<{ username: string; nickname: string }> = [
    { username: 'risk-user-2', nickname: '刷票体验官乙' },
    { username: 'risk-user-3', nickname: '刷票体验官丙' },
    { username: 'risk-user-4', nickname: '刷票体验官丁' },
    { username: 'risk-user-5', nickname: '刷票体验官戊' },
  ];
  for (const spec of specs) {
    await prisma.user.upsert({
      where: { username: spec.username },
      update: { nickname: spec.nickname, role: ROLE.USER, status: USER_STATUS.ACTIVE },
      create: { username: spec.username, nickname: spec.nickname, role: ROLE.USER, status: USER_STATUS.ACTIVE },
    });
  }
  console.log(`[seed][user] risk users=${specs.length} 个（刷票演示）`);
}

/** 单条风控演示票定义。 */
interface RiskVoteSeed {
  id: string;
  projectSlug: string;
  username: string;
  ip: string;
  deviceHash: string;
  dwellMs: number;
  /** 相对 now 的毫秒偏移（负 = 过去）。 */
  createdAtOffsetMs: number;
  /** 该票入库的 riskScore（按场景稳态评估写入，保证审计页开箱即见）。 */
  riskScore: number;
}

/**
 * 播种风控演示数据（P2 风控模块，Q9）：
 *
 *   A. 同 IP 高频 + 同 IP 多账号（IP 203.0.113.10，5 票 / 3 账号 / 1 分钟窗口）
 *      → IP_HIGH_FREQ(30) + IP_MULTI_ACCOUNT(25) = 55（可疑分组）
 *   B. 同设备多账号 + 秒级连投（设备 dev-shared-7f3a，3 账号 / 3 个不同 IP / 相邻 ≤3s）
 *      → DEVICE_MULTI_ACCOUNT(35) + RAPID_CONSECUTIVE(20) = 55（可疑分组）
 *   C. 高危组合（设备 dev-abuse-5b2e + 同一 IP .30，3 账号 / 相邻 ≤3s）
 *      → DEVICE_MULTI_ACCOUNT(35) + IP_MULTI_ACCOUNT(25) + RAPID_CONSECUTIVE(20) = 80（高危分组）
 *
 * 固定 id 保证重复 seed 幂等（upsert）；结束后按 COUNT(valid=true) 全量重算
 * 受影响作品的 ProjectStats.voteCount（与作废事务同口径，自愈）。
 */
async function seedRiskVotes(prisma: PrismaClient): Promise<void> {
  const now = Date.now();
  const MINUTE = 60_000;
  const SEC = 1000;

  const votes: RiskVoteSeed[] = [
    // ---- A：同 IP 高频 + 同 IP 多账号（IP .10，1 分钟窗口 5 票 / 3 账号）----
    { id: 'risk-seed-a1', projectSlug: 'Aur9raFx', username: 'demo', ip: '203.0.113.10', deviceHash: 'dev-ip-a1b2c3', dwellMs: 1200, createdAtOffsetMs: -58 * SEC, riskScore: 55 },
    { id: 'risk-seed-a2', projectSlug: 'NebuLa42', username: 'risk-user-2', ip: '203.0.113.10', deviceHash: 'dev-ip-d4e5f6', dwellMs: 900, createdAtOffsetMs: -52 * SEC, riskScore: 55 },
    { id: 'risk-seed-a3', projectSlug: 'PuLse7Kd', username: 'risk-user-2', ip: '203.0.113.10', deviceHash: 'dev-ip-d4e5f6', dwellMs: 800, createdAtOffsetMs: -45 * SEC, riskScore: 55 },
    { id: 'risk-seed-a4', projectSlug: 'Aur9raFx', username: 'risk-user-3', ip: '203.0.113.10', deviceHash: 'dev-ip-g7h8i9', dwellMs: 1500, createdAtOffsetMs: -30 * SEC, riskScore: 55 },
    { id: 'risk-seed-a5', projectSlug: 'NebuLa42', username: 'risk-user-3', ip: '203.0.113.10', deviceHash: 'dev-ip-g7h8i9', dwellMs: 1100, createdAtOffsetMs: -12 * SEC, riskScore: 55 },
    // ---- B：同设备多账号 + 秒级连投（设备 dev-shared-7f3a，3 账号 / 3 IP / ≤3s）----
    { id: 'risk-seed-b1', projectSlug: 'Aur9raFx', username: 'risk-user-2', ip: '203.0.113.21', deviceHash: 'dev-shared-7f3a', dwellMs: 700, createdAtOffsetMs: -90 * SEC, riskScore: 55 },
    { id: 'risk-seed-b2', projectSlug: 'PuLse7Kd', username: 'risk-user-3', ip: '203.0.113.22', deviceHash: 'dev-shared-7f3a', dwellMs: 650, createdAtOffsetMs: -88 * SEC, riskScore: 55 },
    { id: 'risk-seed-b3', projectSlug: 'NebuLa42', username: 'risk-user-4', ip: '203.0.113.23', deviceHash: 'dev-shared-7f3a', dwellMs: 600, createdAtOffsetMs: -86 * SEC, riskScore: 55 },
    // ---- C：高危组合（设备 dev-abuse-5b2e + 同 IP .30，3 账号 / ≤3s）----
    { id: 'risk-seed-c1', projectSlug: 'NebuLa42', username: 'demo', ip: '203.0.113.30', deviceHash: 'dev-abuse-5b2e', dwellMs: 300, createdAtOffsetMs: -3 * SEC, riskScore: 80 },
    { id: 'risk-seed-c2', projectSlug: 'Aur9raFx', username: 'risk-user-4', ip: '203.0.113.30', deviceHash: 'dev-abuse-5b2e', dwellMs: 260, createdAtOffsetMs: -2 * SEC, riskScore: 80 },
    { id: 'risk-seed-c3', projectSlug: 'PuLse7Kd', username: 'risk-user-5', ip: '203.0.113.30', deviceHash: 'dev-abuse-5b2e', dwellMs: 220, createdAtOffsetMs: -1 * SEC, riskScore: 80 },
  ];

  const affectedProjectIds = new Set<string>();
  for (const spec of votes) {
    const project = await prisma.project.findUnique({ where: { slug: spec.projectSlug }, select: { id: true } });
    const user = await prisma.user.findUnique({ where: { username: spec.username }, select: { id: true } });
    if (!project || !user) {
      console.warn(`[seed][risk] 跳过 ${spec.id}：project=${spec.projectSlug} user=${spec.username}`);
      continue;
    }
    affectedProjectIds.add(project.id);
    const createdAt = new Date(now + spec.createdAtOffsetMs);
    await prisma.vote.upsert({
      where: { id: spec.id },
      update: {
        projectId: project.id,
        userId: user.id,
        campaignId: null,
        valid: true,
        invalidReason: null,
        ip: spec.ip,
        uaHash: null,
        deviceHash: spec.deviceHash,
        dwellMs: spec.dwellMs,
        riskScore: spec.riskScore,
        createdAt,
      },
      create: {
        id: spec.id,
        projectId: project.id,
        userId: user.id,
        campaignId: null,
        valid: true,
        invalidReason: null,
        ip: spec.ip,
        uaHash: null,
        deviceHash: spec.deviceHash,
        dwellMs: spec.dwellMs,
        riskScore: spec.riskScore,
        createdAt,
      },
    });
  }

  // 受影响作品 voteCount 全量重算（COUNT(valid=true)，与作废事务同口径）
  for (const projectId of affectedProjectIds) {
    const validCount = await prisma.vote.count({ where: { projectId, valid: true } });
    await prisma.projectStats.upsert({
      where: { projectId },
      update: { voteCount: validCount },
      create: { projectId, voteCount: validCount },
    });
  }

  console.log(`[seed][risk] 风控演示票 ${votes.length} 条（A 同IP 5票/3账号 · B 同设备 3账号 · C 高危 3账号/同IP）`);
}

/** 播种单件作品：落盘素材（storage 分发）→ 写 meta → 写封面 → 入库。 */
async function seedProject(prisma: PrismaClient, spec: DemoSpec): Promise<void> {
  const sourceDir = path.join(FIXTURES_DIR, spec.fixture);
  await seedProjectFromDir(sourceDir, spec.slug, true);

  // 双后端统一取文件清单/体积（local=磁盘；blob=LIST prefix）
  const files = await listProjectFiles(spec.slug);
  const sizeBytes = await projectDirSize(spec.slug);

  const createdAt = new Date(Date.now() - spec.createdDaysAgo * MS_PER_DAY);
  const expireAt = new Date(createdAt.getTime() + spec.ttlDays * MS_PER_DAY);

  const meta: ProjectMeta = {
    slug: spec.slug,
    title: spec.title,
    sourceType: spec.sourceType,
    entryFile: 'index.html',
    fileCount: files.length,
    sizeBytes,
    uploadedAt: createdAt.toISOString(),
    expireAt: expireAt.toISOString(),
    ignoredFiles: [],
    kernelVersion: 'p0',
  };
  await writeMeta(spec.slug, meta);
  // covers 不落 Blob：covers 路由有「磁盘缺失 → 即时生成」fallback，云模式直接走生成
  await writeCover(spec.slug, buildCoverSvg(spec.slug, spec.title));

  const data = {
    slug: spec.slug,
    title: spec.title,
    summary: spec.summary,
    description: spec.description,
    coverUrl: null,
    sourceType: spec.sourceType,
    entryFile: 'index.html',
    fileCount: files.length,
    sizeBytes,
    visibility: spec.visibility,
    status: PROJECT_STATUS.ACTIVE,
    ttlDays: spec.ttlDays,
    expireAt,
    authorAlias: spec.authorAlias,
    authorId: LOCAL_DEMO_USER_ID,
    createdAt,
    // 截图文件名 JSON 串（与 ProjectMeta.screenshots 解析格式一致）
    screenshots: JSON.stringify(spec.screenshots),
  };

  const project = await prisma.project.upsert({
    where: { slug: spec.slug },
    update: data,
    create: data,
  });

  await prisma.projectStats.upsert({
    where: { projectId: project.id },
    update: { viewCount: spec.viewCount },
    create: { projectId: project.id, viewCount: spec.viewCount },
  });

  console.log(
    `[seed][project] slug=${spec.slug} files=${files.length} size=${sizeBytes} ` +
      `visibility=${spec.visibility} ttl=${spec.ttlDays}d expireAt=${expireAt.toISOString()}`,
  );
}

/** 建立演示收藏（P3 个人空间，T05）：demo 用户收藏 2 件 seed 作品，收藏 Tab 开箱非空。 */
async function seedFavorites(prisma: PrismaClient): Promise<void> {
  const favoriteSlugs = ['Aur9raFx', 'NebuLa42'];
  for (const slug of favoriteSlugs) {
    const project = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
    if (!project) {
      console.warn(`[seed][favorite] 跳过收藏：作品 ${slug} 不存在`);
      continue;
    }
    await prisma.favorite.upsert({
      where: { userId_projectId: { userId: LOCAL_DEMO_USER_ID, projectId: project.id } },
      update: {},
      create: { userId: LOCAL_DEMO_USER_ID, projectId: project.id },
    });
    console.log(`[seed][favorite] user=${LOCAL_DEMO_USER_ID} project=${slug}`);
  }
}

/**
 * 播种一场演示活动（P1 活动模块）。
 *
 * 存储态为 collecting，但 collectEndAt / voteStartAt 已过 → computeStatus 懒计算为
 * voting：广场可见、可筛选、可投活动票；同时演示「时间窗到点自动推进」机制。
 * 报名演示作者（local-demo-user）的两件公开作品，保证活动页非空。
 */
async function seedCampaign(prisma: PrismaClient): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { username: 'admin' } });
  const authorId = admin?.id ?? LOCAL_DEMO_USER_ID;

  const collectEndAt = new Date(Date.now() - 1 * MS_PER_DAY);
  const voteStartAt = new Date(Date.now() - 1 * MS_PER_DAY);
  const voteEndAt = new Date(Date.now() + 30 * MS_PER_DAY);

  const campaign = await prisma.campaign.upsert({
    where: { slug: 'camp-demo1' },
    update: {
      title: 'Kernel 夏日创意种子征集',
      description:
        '围绕「夏日」主题提交你的静态作品：粒子、动效、小游戏、落地页皆可。\n\n' +
        '· 每人最多投 3 票（跨作品累计）\n' +
        '· 允许给自己投票\n' +
        '· 活动榜按活动内票数实时排序\n\n这是演示活动，时间窗自动进入投票期。',
      status: CAMPAIGN_STATUS.COLLECTING,
      collectEndAt,
      voteStartAt,
      voteEndAt,
      maxVotesPerUser: 3,
      allowSelfVote: true,
      voteWeight: 1,
      authorId,
    },
    create: {
      slug: 'camp-demo1',
      title: 'Kernel 夏日创意种子征集',
      description:
        '围绕「夏日」主题提交你的静态作品：粒子、动效、小游戏、落地页皆可。\n\n' +
        '· 每人最多投 3 票（跨作品累计）\n' +
        '· 允许给自己投票\n' +
        '· 活动榜按活动内票数实时排序\n\n这是演示活动，时间窗自动进入投票期。',
      status: CAMPAIGN_STATUS.COLLECTING,
      collectEndAt,
      voteStartAt,
      voteEndAt,
      maxVotesPerUser: 3,
      allowSelfVote: true,
      voteWeight: 1,
      authorId,
    },
  });
  console.log(`[seed][campaign] slug=${campaign.slug} status=${campaign.status} author=${authorId}`);

  // 报名两件公开作品（便于演示活动页 / 活动票）
  const joinSlugs = ['Aur9raFx', 'NebuLa42'];
  for (const slug of joinSlugs) {
    const project = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
    if (!project) {
      console.warn(`[seed][campaign] 跳过报名：作品 ${slug} 不存在`);
      continue;
    }
    await prisma.projectCampaign.upsert({
      where: { campaignId_projectId: { campaignId: campaign.id, projectId: project.id } },
      update: { status: PROJECT_CAMPAIGN_STATUS.JOINED },
      create: { campaignId: campaign.id, projectId: project.id, status: PROJECT_CAMPAIGN_STATUS.JOINED },
    });
    console.log(`[seed][campaign] joined=${slug} campaign=${campaign.slug}`);
  }
}

/**
 * 执行全部演示数据播种（幂等）。供 CLI 与 Vercel Cron 自动 seed 复用。
 *
 * @param prisma 已连接的 PrismaClient（本地原生引擎 / Turso adapter 均可）。
 */
export async function runSeed(prisma: PrismaClient): Promise<void> {
  console.log('[seed][start] 正在播种演示数据…');
  await ensureDataSkeleton();
  await seedUser(prisma);
  await seedAdmin(prisma);
  await seedRiskUsers(prisma);
  for (const spec of DEMOS) {
    await seedProject(prisma, spec);
  }
  await seedCampaign(prisma);
  await seedFavorites(prisma);
  await seedRiskVotes(prisma);
  console.log(`[seed][done] 共 ${DEMOS.length} 件作品 + 1 场演示活动 + 演示收藏 + 风控演示票`);
}
