# Kernel · 创意种子 — 数据模型与 API 设计

---

## 一、ER 关系

```
users ──< projects ──< project_tags >── tags
  │          │
  │          ├──< project_campaigns >── campaigns
  │          ├──< votes >───────────────┘
  │          └──< project_stats (1:1)
  │
  ├──< votes
  └──< audit_logs

projects ──< cleanup_logs
```

---

## 二、Prisma Schema

```prisma
// ---------- 用户 ----------
model User {
  id            String   @id @default(cuid())
  unionid       String?  @unique              // 微信开放平台统一 ID
  openidMp      String?  @unique              // 公众号 openid
  openidOpen    String?  @unique              // 网站应用 openid
  phone         String?  @unique              // 兜底登录
  nickname      String
  avatarUrl     String?
  role          Role     @default(USER)       // USER | JUDGE | ADMIN | SUPER_ADMIN
  status        UserStatus @default(ACTIVE)   // ACTIVE | BANNED
  riskLevel     Int      @default(0)          // 0 正常 / 1 观察 / 2 高风险
  lastLoginAt   DateTime?
  createdAt     DateTime @default(now())

  projects      Project[]
  votes         Vote[]
  auditLogs     AuditLog[]

  @@index([role, status])
}

enum Role       { USER JUDGE ADMIN SUPER_ADMIN }
enum UserStatus { ACTIVE BANNED }

// ---------- 作品 ----------
model Project {
  id            String   @id @default(cuid())
  slug          String   @unique              // 8 位 base58 短码 = 目录名 = 子域
  customSlug    Boolean  @default(false)

  title         String
  summary       String?  @db.VarChar(200)
  description   String?  @db.Text             // Markdown
  coverUrl      String?
  ogImageUrl    String?

  sourceType    SourceType                    // SINGLE_FILE | ZIP | EXTERNAL_URL
  externalUrl   String?                       // 外链模式
  entryFile     String   @default("index.html")
  fileCount     Int      @default(0)
  sizeBytes     BigInt   @default(0)

  visibility    Visibility @default(PUBLIC)   // PUBLIC | UNLISTED | PRIVATE
  accessKey     String?                       // 私密作品的签名密钥
  status        ProjectStatus @default(ACTIVE)// ACTIVE | ARCHIVED | PURGED | BLOCKED

  ttlDays       Int      @default(90)         // 默认 90 天
  expireAt      DateTime                      // 发布时 = now + ttlDays
  exemptExpire  Boolean  @default(false)      // 豁免过期（获奖/置顶）
  archivedAt    DateTime?
  purgeAt       DateTime?                     // 归档后 30 天

  pinned        Boolean  @default(false)
  authorAlias   String?                       // 覆盖署名（团队名）

  authorId      String
  author        User     @relation(fields: [authorId], references: [id])

  tags          ProjectTag[]
  campaigns     ProjectCampaign[]
  votes         Vote[]
  stats         ProjectStats?

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([visibility, status, createdAt])
  @@index([expireAt, status])
  @@index([authorId])
}

enum SourceType    { SINGLE_FILE ZIP EXTERNAL_URL }
enum Visibility    { PUBLIC UNLISTED PRIVATE }
enum ProjectStatus { ACTIVE ARCHIVED PURGED BLOCKED }

// ---------- 作品统计（拆表避免热点行锁）----------
model ProjectStats {
  projectId     String   @id
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  voteCount     Int      @default(0)          // 有效票
  voteInvalid   Int      @default(0)          // 已作废票
  viewCount     Int      @default(0)
  uniqueVisitor Int      @default(0)
  deepViewCount Int      @default(0)          // 停留 >10s
  hotScore      Float    @default(0)          // 热度分，定时重算
  firstVoteAt   DateTime?
  updatedAt     DateTime @updatedAt

  @@index([hotScore])
  @@index([voteCount])
}

// ---------- 活动 ----------
model Campaign {
  id             String   @id @default(cuid())
  slug           String   @unique
  name           String
  coverUrl       String?
  description    String?  @db.Text
  organizer      String?

  startAt        DateTime
  endAt          DateTime
  voteStartAt    DateTime?
  voteEndAt      DateTime?

  maxVotesPerUser Int?    // null = 不限
  allowSelfVote  Boolean  @default(true)
  resultVisible  ResultVisibility @default(REALTIME)
  judgeWeight    Int      @default(1)
  requireAudit   Boolean  @default(false)     // 参赛作品需审核

  status         CampaignStatus @default(DRAFT)
  projects       ProjectCampaign[]
  votes          Vote[]
  createdAt      DateTime @default(now())
}

enum ResultVisibility { REALTIME AFTER_END HIDDEN }
enum CampaignStatus   { DRAFT RUNNING ENDED ARCHIVED }

model ProjectCampaign {
  projectId   String
  campaignId  String
  auditStatus AuditStatus @default(APPROVED)  // PENDING | APPROVED | REJECTED
  awardLabel  String?                          // "一等奖" 等，打上后自动豁免过期
  joinedAt    DateTime @default(now())

  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  campaign    Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  @@id([projectId, campaignId])
  @@index([campaignId, auditStatus])
}

enum AuditStatus { PENDING APPROVED REJECTED }

// ---------- 标签 ----------
model Tag {
  id        String  @id @default(cuid())
  name      String  @unique
  color     String? // 可指定强调色
  useCount  Int     @default(0)
  projects  ProjectTag[]
}

model ProjectTag {
  projectId String
  tagId     String
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  tag       Tag     @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([projectId, tagId])
}

// ---------- 投票 ----------
model Vote {
  id           String   @id @default(cuid())
  projectId    String
  userId       String
  campaignId   String?                        // 该票归属活动，null = 全站赞
  weight       Int      @default(1)           // 评委加权
  valid        Boolean  @default(true)        // 被作废置 false
  invalidReason String?

  ip           String?
  uaHash       String?
  deviceHash   String?
  dwellMs      Int?                           // 投票前页面停留毫秒
  riskScore    Int      @default(0)

  createdAt    DateTime @default(now())

  project      Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user         User     @relation(fields: [userId], references: [id])
  campaign     Campaign? @relation(fields: [campaignId], references: [id])

  @@unique([projectId, userId])               // 一人一作品一票
  @@index([campaignId, valid])
  @@index([userId, createdAt])
  @@index([deviceHash])
}

// ---------- 审计与清理 ----------
model AuditLog {
  id         String   @id @default(cuid())
  actorId    String
  actor      User     @relation(fields: [actorId], references: [id])
  action     String                            // project.delete / vote.invalidate / project.viewPrivate ...
  targetType String
  targetId   String
  detail     Json?
  ip         String?
  createdAt  DateTime @default(now())

  @@index([actorId, createdAt])
  @@index([targetType, targetId])
}

model CleanupLog {
  id          String   @id @default(cuid())
  batchId     String
  projectId   String
  action      String                           // archive | purge | notify
  freedBytes  BigInt   @default(0)
  success     Boolean  @default(true)
  message     String?
  createdAt   DateTime @default(now())

  @@index([batchId])
}
```

---

## 三、REST API 设计

统一前缀 `/api`，统一响应体：

```json
{ "ok": true,  "data": { }, "meta": { "page": 1, "total": 128 } }
{ "ok": false, "error": { "code": "VOTE_LIMIT_EXCEEDED", "message": "本活动最多投 3 票" } }
```

### 3.1 作品

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `GET` | `/api/projects` | 广场列表。参数：`sort=hot\|new\|votes`、`campaign`、`tag`、`q`、`page` | 公开 |
| `GET` | `/api/projects/:slug` | 作品详情 | 按可见性 |
| `POST` | `/api/projects/upload-init` | 初始化上传，返回 `uploadId` + 分片策略 | 登录 |
| `PUT` | `/api/projects/upload-chunk` | 上传分片 | 登录 |
| `POST` | `/api/projects/upload-complete` | 合并 + 校验 + 解压，返回文件树与推荐入口 | 登录 |
| `POST` | `/api/projects` | 创建作品（携带 `uploadId` 或 `externalUrl` + 元信息），返回 `slug` | 登录 |
| `PATCH` | `/api/projects/:slug` | 改标题/简介/可见性/标签/有效期 | 作者 or 管理员 |
| `POST` | `/api/projects/:slug/renew` | 续期，重置 `expireAt` | 作者 or 管理员 |
| `DELETE` | `/api/projects/:slug` | 软删除进回收站 | 作者 or 管理员 |
| `POST` | `/api/projects/:slug/access-token` | 生成私密作品的临时访问签名 | 作者 or 管理员 |
| `POST` | `/api/projects/:slug/report` | 举报 | 公开 |

### 3.2 投票

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/votes` | body: `{ projectId, campaignId?, dwellMs }` → 投票（幂等） |
| `DELETE` | `/api/votes/:projectId` | 取消投票 |
| `GET` | `/api/votes/me` | 我投过的作品 id 列表（前端批量渲染已投状态） |
| `GET` | `/api/votes/quota?campaign=` | 剩余票数 |

**错误码**：`NOT_LOGGED_IN` / `VOTE_LIMIT_EXCEEDED` / `SELF_VOTE_FORBIDDEN` / `VOTE_WINDOW_CLOSED` / `RATE_LIMITED` / `CAPTCHA_REQUIRED` / `ALREADY_VOTED`

### 3.3 排行榜

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/rank?scope=global\|campaign&range=day\|week\|all&campaign=&limit=50` | 榜单，Redis ZSET 直出 |
| `GET` | `/api/rank/screen/:campaignSlug` | 大屏专用，含 SSE 实时推送通道 |

### 3.4 活动

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/campaigns` | 活动列表 |
| `GET` | `/api/campaigns/:slug` | 活动详情 + 规则 |
| `POST` | `/api/campaigns/:slug/join` | 作品报名参赛 |
| `POST` | `/api/admin/campaigns` | 建活动 |
| `PATCH` | `/api/admin/campaigns/:id` | 改规则 |
| `GET` | `/api/admin/campaigns/:id/export` | 导出成绩单 xlsx |

### 3.5 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/auth/wechat/qrcode` | 返回扫码登录跳转地址 + state |
| `GET` | `/api/auth/wechat/callback` | 微信回调，换取 unionid，建会话 |
| `GET` | `/api/auth/wechat/mp` | 微信内网页授权入口 |
| `POST` | `/api/auth/phone/send` / `/verify` | 兜底手机号登录 |
| `GET` | `/api/auth/me` | 当前用户 |
| `POST` | `/api/auth/logout` | 退出 |

### 3.6 管理后台

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/overview` | 概览指标 |
| `GET` | `/api/admin/projects` | 全量作品（含私密），支持多维筛选 |
| `POST` | `/api/admin/projects/:id/block` | 强制下架 |
| `POST` | `/api/admin/projects/:id/purge` | 立即物理删除 |
| `POST` | `/api/admin/projects/batch` | 批量操作：续期/删除/改可见性/置顶 |
| `GET` | `/api/admin/votes/audit` | 票据审计，按 IP/设备/用户聚合 |
| `POST` | `/api/admin/votes/invalidate` | 批量作废票 + 触发榜单重算 |
| `GET` | `/api/admin/users` / `POST /:id/ban` | 用户管理 |
| `GET` | `/api/admin/storage` | 存储用量排行 + 孤儿文件 |
| `GET`/`PATCH` | `/api/admin/settings` | 系统设置（默认 TTL、上传限额、CSP、验证码开关） |
| `POST` | `/api/admin/cleanup/run` | 手动触发清理 |
| `GET` | `/api/admin/audit-logs` | 操作留痕 |

### 3.7 图片生成

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/og/:slug.png` | OG 卡片 1200×630，CDN 缓存 |
| `GET` | `/poster/:slug.png` | 分享海报 1080×1440，带二维码 |
| `GET` | `/poster/campaign/:slug.png` | 榜单战报 |

---

## 四、定时任务

| 任务 | 频率 | 逻辑 |
|------|------|------|
| `expire-notify` | 每日 09:00 | 查 `expireAt` 在 7 天 / 1 天内的作品 → 微信模板消息 + 站内信 |
| `expire-archive` | 每日 03:00 | `expireAt < now && !exemptExpire` → 状态改 ARCHIVED，`purgeAt = now + 30d`，Nginx 返回 410 |
| `purge-files` | 每日 03:30 | `purgeAt < now` → 物理删除目录与对象存储文件，写 CleanupLog |
| `rank-recalc` | 每 5 分钟 | 以 DB 为准重算 hotScore，校准 Redis ZSET |
| `vote-reconcile` | 每 5 分钟 | Redis 计数 vs DB votes 表对账 |
| `risk-scan` | 每小时 | 扫描同设备/同 IP 集中投票，打风险标记并告警 |
| `orphan-scan` | 每周日 04:00 | 扫描磁盘上无对应 DB 记录的目录 |
| `db-backup` | 每日 02:00 | pg_dump + 上传冷存储 |

---

## 五、前端目录结构

```
src/
├── app/
│   ├── (site)/
│   │   ├── page.tsx                  # 广场
│   │   ├── w/[slug]/page.tsx         # 作品详情
│   │   ├── new/page.tsx              # 上传发布
│   │   ├── rank/page.tsx             # 排行榜
│   │   ├── c/[slug]/page.tsx         # 活动主页
│   │   ├── c/[slug]/screen/page.tsx  # 大屏
│   │   └── me/page.tsx               # 用户中心
│   ├── admin/                        # 后台（独立 layout）
│   ├── api/                          # Route Handlers
│   └── og/[slug]/route.tsx           # Satori 图片生成
├── components/
│   ├── ui/                           # shadcn 改造后的基础组件
│   ├── project/  ProjectCard / VoteButton / PreviewFrame / SharePoster
│   ├── rank/     RankList / MedalBadge / ScreenBoard
│   └── upload/   Dropzone / FileTree / PublishSuccess
├── lib/          api / auth / redis / prisma / slug / sandbox / rank
├── styles/       globals.css（DESIGN.md token 落地）
└── workers/      unzip / screenshot / poster / cleanup
```
