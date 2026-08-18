# Kernel · 创意种子

静态作品发布平台 P0 骨架（Next.js App Router + Prisma/SQLite 本地轻量桩）。
支持上传 ZIP / 单 HTML / 外链发布，沙箱直出（CSP 不透明源隔离），作品生命周期
（过期归档 / 回收站清除 / 临时目录回收 / 孤儿巡检），活动报名与投票，后台管理与风控审计。

## 快速开始（本地）

```bash
npm install
npm run db:reset        # 建库 + seed 3 件演示作品
npm run dev             # http://localhost:3000
```

常用命令：

```bash
npm run typecheck       # tsc --noEmit
npm run build           # next build
npm run cleanup:once    # 手动跑一轮生命周期清理
npm run cleanup:cron    # 常驻 node-cron（本地桩）
npm run db:push-remote  # 把 schema DDL 应用到 Turso 远端（生产）
```

## 测试

```bash
# 单测（含双模式判定探针 tests/unit/vercel-mode.test.ts）
node --require ./tests/qa/qa-register.cjs --import tsx --test tests/unit/*.test.ts

# QA 关键套件（先 npm run build && npx next start -p 3322）
node --import tsx --test tests/qa/p1-http.test.ts
node --import tsx --test tests/qa/campaign-verify.test.ts
node --import tsx --test tests/qa/p3-dashboard-verify.test.ts
```

## 部署（Vercel 试验版）

本仓库支持**双模式**：本地原生引擎 + 本地磁盘（默认），或
**Vercel + Turso（libsql）+ Vercel Blob + Vercel Cron**（生产）。

详细操作手册见 **[`docs/Vercel试验部署指南.md`](docs/Vercel试验部署指南.md)**；
增量设计见 **[`docs/P0-Vercel试验部署设计.md`](docs/P0-Vercel试验部署设计.md)**。

部署前在 Vercel 项目配置环境变量（要点）：

| 变量 | 值 | 说明 |
|------|-----|------|
| `DATABASE_URL` | `libsql://{db}-{org}.turso.io` | `libsql:` 前缀 = Turso 云模式 |
| `TURSO_AUTH_TOKEN` | `eyJ...` | Turso 认证 token |
| `BLOB_READ_WRITE_TOKEN` | 创建 Blob Store 后自动注入 | 存储云模式开关 |
| `CRON_SECRET` | 随机强值 | Vercel cron 自动作为 Bearer 头附带；手动 curl 也用它 |
| `KERNEL_DATA_DIR` | `/tmp/kernel-data` | 生产单请求临时盘 |
| `SITE_URL` | `https://{project}.vercel.app` | 短链 / 沙箱地址拼接 |
| `AUTH_SECRET` | 随机强值 | 登录 cookie 签名 |

部署后首次手动验证：

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://{project}.vercel.app/api/cron/run
```

首次运行（空库）会自动 seed 演示数据并执行一轮生命周期清理，返回统一 `{ok, data}` 报告。

## 文档索引

- `docs/01-产品方案.md` / `02-技术架构.md` / `03-数据模型与API.md` / `04-实施路线图.md`
- `docs/P0-架构与任务分解.md`、`docs/P0-Vercel试验部署设计.md`
- `docs/P1-活动模块设计.md`、`docs/P2-后台管理设计.md`、`docs/P2-风控模块设计.md`、`docs/P3-个人空间设计.md`、`docs/P3-我的后台设计.md`
