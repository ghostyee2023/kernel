# Kernel · 创意种子 —— Vercel 试验部署指南

> 适用：P0 本地轻量桩 → Vercel（Hobby 免费层）试验寄放。设计真源见
> [`docs/P0-Vercel试验部署设计.md`](./P0-Vercel试验部署设计.md)（T1–T5 + Q1–Q7 拍板项）。
>
> 原理一句话：**数据层走 Turso（libsql，HTTP，schema 仍是 SQLite），存储层走 Vercel Blob（REST 直调零依赖），调度层走 Vercel Cron + `/api/cron/run`，空库自动 seed 演示数据。**

---

## 0. 前置条件

| 项 | 说明 |
|----|------|
| GitHub 仓库 | 本项目已初始化为仓库（含 `.gitignore`；`dev.db` / `.kernel-data` / `.next` 不入库） |
| Turso 账号 | 免费额度足够试验（`turso.com`），或本机装 `turso` CLI |
| Vercel 账号 | Hobby 免费层即可（cron 每天最多 1 次；函数最长 300s；请求体 4.5MB） |
| Node | ≥ 20.11（本仓库 engines 要求） |

---

## 1. Turso：建库 → 拿连接串 / token → 应用表结构

```bash
# 1) 登录并建库（本机无 CLI 也可在 Dashboard 网页建）
turso auth login
turso db create kernel-demo

# 2) 拿连接串（形如 libsql://kernel-demo-{org}.turso.io）
turso db show kernel-demo --url

# 3) 生成长期 token（写入 TURSO_AUTH_TOKEN）
turso db tokens create kernel-demo
```

应用表结构（schema 仍是唯一真源，provider 保持 `sqlite`）：

```bash
# 生成 DDL（prisma/migration-remote.sql）并尝试经 turso CLI 应用；
# 未装 turso CLI 时按脚本末尾指引手动应用（Dashboard SQL 面板粘贴亦可）
DATABASE_URL="libsql://kernel-demo-{org}.turso.io" \
TURSO_AUTH_TOKEN="eyJ..." \
npm run db:push-remote
```

验证：`SELECT name FROM sqlite_master WHERE type='table' AND name='Project';`

---

## 2. Vercel Blob：创建 Store 并准备 token

1. Vercel 项目 → Storage → Create Database → **Blob**（选离用户近的 Region）。
2. 创建后 Vercel **自动注入环境变量** `BLOB_READ_WRITE_TOKEN`（形如 `vercel_blob_rw_{storeId}_{secret}`），
   无需手填；代码同时兼容 `BLOB_TOKEN` 别名。
3. `BLOB_STORE_ID` 会自动注入；未注入时代码会从 token 解析 storeId，一般无需手配。

> 存储云模式开关：`NODE_ENV=production` 且（`BLOB_READ_WRITE_TOKEN` 或 `BLOB_TOKEN`）存在 → 走 Blob REST；
> 否则回退本地磁盘（部署不崩，但试验版文档要求必须配 Blob，否则文件不持久）。

---

## 3. Vercel 项目：导入 GitHub 仓库

1. Vercel Dashboard → Add New → Project → Import Git Repository（选本项目仓库）。
2. Framework Preset 自动识别 **Next.js**；构建命令 / 输出目录保持默认
   （`npm run build` / Next.js 默认输出）。
3. 确认无 `distDir` 冲突（本仓库 `next.config.ts` 无 distDir）。

---

## 4. 环境变量（全量设置）

Vercel 项目 → Settings → Environment Variables（Production 环境）：

| 变量 | 值 | 说明 |
|------|-----|------|
| `DATABASE_URL` | `libsql://kernel-demo-{org}.turso.io` | `libsql:` 前缀 = Turso 云模式（数据层开关） |
| `TURSO_AUTH_TOKEN` | `eyJ...` | Turso 认证 token |
| `BLOB_READ_WRITE_TOKEN` | 自动注入，可确认存在 | Blob 写 token（存储层开关） |
| `CRON_SECRET` | `openssl rand -base64 32` 生成的随机串 | **Vercel 会把它自动作为 `Authorization: Bearer` 头附到 cron 请求**；同时供手动 curl 鉴权 |
| `KERNEL_DATA_DIR` | `/tmp/kernel-data` | 生产为单请求临时盘（冷启动重置，持久文件全在 Blob） |
| `SITE_URL` | `https://{project}.vercel.app` | 拼接 detailUrl / sandboxUrl |
| `AUTH_SECRET` | 随机强值 | 登录 cookie 签名（生产必须显式设置） |
| `MAX_UPLOAD_MB` | `20` | 生产上传上限（Q5 拍板；Hobby 300s 窗口内下载+解压+重传安全） |
| `SANDBOX_MODE` | `subpath`（缺省） | 试验版保持同源 + CSP opaque origin，与本地一致 |

> 建议：`MAX_EXTRACTED_MB=200`、`MAX_ZIP_ENTRIES=2000`、`MAX_ZIP_RATIO=100` 保持默认即可。

---

## 5. 首次部署

```bash
# 本地先跑一遍回归（可选但推荐）：
npm run db:reset && npx tsc --noEmit && npm run build

# 推送到 GitHub 后，Vercel 自动部署；或命令行：
vercel --prod
```

部署成功后：

1. 先手动触发一次 cron，验证「空库自动 seed + runAll」全链路：

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://{project}.vercel.app/api/cron/run
```

期望：`200`，响应体 `{"ok":true,"data":{...,"seeded":true,...}}`，
`data.totals` 为生命周期四任务的汇总报告。

2. 打开 `https://{project}.vercel.app/` → 广场应出现 3 件 seed 演示作品
   （Aurora Field / Nebula / Pulse）。
3. 访问沙箱：`https://{project}.vercel.app/sandbox/Aur9raFx/` → 作品可渲染且安全头齐全
   （CSP `sandbox`、无 `Set-Cookie`、`X-Robots-Tag: noindex`）。

---

## 6. Cron 自动调度（每日 03:10 UTC）

`vercel.json` 已配置：

```json
{
  "crons": [{ "path": "/api/cron/run", "schedule": "10 3 * * *" }],
  "functions": { "app/api/cron/run/route.ts": { "maxDuration": 120 } }
}
```

- Vercel 对 cron 发起 **GET** `/api/cron/run`；只要项目配了 `CRON_SECRET`，请求会自动带
  `Authorization: Bearer {CRON_SECRET}`（官方能力，**无需 query 参数**）。
- 路由同时支持 `X-Cron-Secret` 头与 `?secret=` 查询参数（手动 curl / 本地验证便利）。
- 每次执行：鉴权 → 空库自动 seed（幂等 upsert）→ `runAll()`（过期归档 → 回收站清除 →
  临时目录回收 → 孤儿巡检）→ 统一 `{ok, data}`。
- Hobby 免费层限制：**cron 每天最多 1 次**，且在同小时内任意时刻触发（±59 分钟）；
  想每小时执行需 Pro，或改用 GitHub Actions 定时 curl 本端点。
- 在 Vercel Dashboard → Settings → Cron Jobs 可查看 / 停用调度。

---

## 7. 验证清单（部署后逐项确认）

| # | 检查项 | 期望 |
|---|--------|------|
| 1 | 部署构建日志 | 无 Turso 连接失败（构建期不连 DB；直读 DB 页面均已 `force-dynamic`） |
| 2 | `GET /api/health`（如存在）或首页 | 200 |
| 3 | 手动 curl `/api/cron/run`（带 secret） | 200 + `seeded:true`（首次） |
| 4 | 无 / 错 secret curl | 401 `{"ok":false,"error":{"code":"NOT_LOGGED_IN",...}}` |
| 5 | 广场首页 | 3 件 seed 作品可见 |
| 6 | `/sandbox/Aur9raFx/` | 200 + 安全头齐全 |
| 7 | 上传 ZIP（≤20MB）全流程 | init(3MB 分片) → chunk ×N → complete → publish → 沙箱可访问 |
| 8 | Vercel Dashboard → Cron Jobs | 显示每日 03:10 UTC 一条 |

---

## 8. 已知限制与取舍（Q1–Q8 拍板摘要）

- **数据层**：Prisma 6.x 对 Turso 的唯一官方路径是 driver adapter
  （`provider="sqlite"` + `previewFeatures=["driverAdapters"]` + `@prisma/adapter-libsql` +
  `@libsql/client`，共 2 个新依赖）；schema 表结构零改动。
- **存储层**：Blob REST 直调零依赖（`src/lib/blob.ts`）；staging → 最终路径是「下载再上传」
  （Blob 无 rename/copy），试验规模（≤20MB）可接受。若 Vercel REST 契约演进导致维护成本上升，
  回退方案是加 `@vercel/blob` SDK（Q3）。
- **上传**：Vercel Function 请求体上限 4.5MB → 生产分片自动 3MB（本地仍 5MB，客户端契约不变）；
  `/tmp` 仅单请求内合并/解压，冷启动重置无影响；`MAX_UPLOAD_MB=20` 由 Vercel env 控制。
- **自动 seed 范围**：空库（User 与 Project 均为 0）即触发（任务书 T3 拍板，便于本地回归验证）；
  幂等 upsert，重复执行安全。
- **旧数据迁移**：默认不迁移本地 `dev.db` / `.kernel-data`（Q4）；正式上线前再评估迁移脚本。

---

## 9. 本地开发不受影响

本地 `.env` 保持 `DATABASE_URL="file:./dev.db"`、无 Blob token、`NODE_ENV` 非 production
→ 全部走原生引擎 + 本地磁盘，行为与改造前一致。回归命令：

```bash
npm run db:reset                 # 本地 sqlite 重建 + seed
npx tsc --noEmit                 # 类型检查
npm run build                    # 生产构建
# 单测（含双模式探针 tests/unit/vercel-mode.test.ts）
node --require ./tests/qa/qa-register.cjs --import tsx --test tests/unit/*.test.ts
# QA 关键套件（需先 npm run build && npx next start -p 3322）
node --import tsx --test tests/qa/p1-http.test.ts
node --import tsx --test tests/qa/campaign-verify.test.ts
node --import tsx --test tests/qa/p3-dashboard-verify.test.ts
```
