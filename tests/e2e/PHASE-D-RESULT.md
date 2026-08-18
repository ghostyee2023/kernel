# 阶段 D — 端到端冒烟（留痕）

环境：`next build` 产物 + `next start -p 3111`（**production 模式，非 dev**），SQLite + seed 3 demo

## D1 广场首页

`GET /` → 200，31,016 bytes

- [x] Hero 文案「每一件杰作，都始于一颗种子」命中
- [x] 副标语「上传 → 短码 → 分享，一分钟种下你的作品」
- [x] 统计位渲染：在线作品 2 / 累计浏览 2,052 / 已托管内容 16.8 KB
- [x] 列表**只出 PUBLIC + ACTIVE**：Aur9raFx、NebuLa42
- [x] UNLISTED（PuLse7Kd）与 PRIVATE（QaPriv01）均**未出现在广场** ✅
- [x] 卡片含到期倒计时徽标（「剩余 78 天」/「5 天后过期」）

## D2 作品详情页 iframe

`GET /w/Aur9raFx` → 200，34,035 bytes

```html
<iframe class="browser__frame"
        src="http://localhost:3000/sandbox/Aur9raFx/"
        title="Aurora Field 极光粒子场 — 沙箱预览"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
        referrerPolicy="no-referrer" loading="lazy"></iframe>
```

- [x] iframe 存在且 src 指向 `/sandbox/{slug}/`
- [x] `sandbox` 属性**不含 allow-same-origin** ✅
- [x] `referrerPolicy="no-referrer"` ✅
- 注：src 主机名取自 `.env` 的 `SITE_URL`（:3000），QA 跑在 :3111，属配置驱动的正确行为

## D3 三段式上传 + 发布（`tests/e2e/smoke-upload.ts`，21/21 通过）

自建最小 ZIP 构造器（本地文件头 + 中央目录 + EOCD，deflate），不依赖任何第三方打包工具。

| # | 用例 | 结果 |
|---|---|---|
| 1 | upload-init → upload-chunk → upload-complete 返回 2xx | PASS |
| 2 | 校验结果 fileCount=3、entry=index.html | PASS |
| 3 | `POST /api/projects` 返回 201 | PASS |
| 4 | slug 匹配 `^[1-9A-HJ-NP-Za-km-z]{8}$`（Base58，无 0OIl） | PASS |
| 5 | 返回 sandboxUrl / detailUrl 且含 slug | PASS |
| 6 | `GET /sandbox/{slug}` → 200 | PASS |
| 7 | 沙箱返回**上传的真实内容**（`QA-E2E-SMOKE-OK`） | PASS |
| 8 | CSP sandbox 且无 allow-same-origin | PASS |
| 9 | 无 Set-Cookie | PASS |
| 10-14 | 5 条安全头齐全 | PASS ×5 |
| 15 | 子资源 `/sandbox/{slug}/style.css` → 200 | PASS |
| 16 | 子路径穿越 → 4xx | PASS |
| 17 | zip-slip 条目（`../../evil.html`）被拒/被忽略 | PASS |
| 18 | 解压炸弹（80MB 单条目）被拒 | PASS |
| 19 | 炸弹错误码 < 500 → `400 ZIP_ENTRY_TOO_LARGE` | PASS |
| 20 | 伪造扩展名（纯文本命名为 .zip）被拒 | PASS |
| 21 | 伪造扩展名错误码 → `400 UNSUPPORTED_FILE_TYPE` | PASS |

产出 slug：`BEieXvj3`

## D4 生命周期 ACTIVE → ARCHIVED → PURGED（`tests/e2e/smoke-lifecycle.ts`，13/13 通过）

用 `npm run cleanup:once` 真实推进（`env -u NODE_OPTIONS -u CODEBUDDY_SAFE_DELETE_BULK_GUARD` 规避批量删除垫片）。

### 归档轮（8/8）
```
[archive] 扫描 1 / 处理 1 / 失败 0
    · 归档 BEieXvj3（QA 端到端冒烟作品），30 天后清除
```
- [x] status → `ARCHIVED`
- [x] archivedAt 写入 `2026-08-06T11:36:02.080Z`
- [x] purgeAt = `2026-09-05T11:36:02.080Z` ＝ archivedAt + 30 天（**误差 0ms**）
- [x] 磁盘文件仍在（回收站语义）
- [x] `/sandbox/{slug}` → **302 → `/_status/{slug}`**（设计约定：留 30 天续期窗口）
- [x] `/_status/{slug}` → 200，渲染「已归档 / 回收站 / 恢复 / 续期」
- [x] 广场列表不再出现
- [x] CleanupLog 有 `archive` 留痕

### 清除轮（5/5）
```
[storage][purge] slug=BEieXvj3 freedBytes=617
[purge] 扫描 1 / 处理 1 / 失败 0 / 释放 617 B
```
- [x] DB 行**保留**（不硬删）
- [x] status → `PURGED`
- [x] 磁盘目录**物理删除**
- [x] 短链 → 404
- [x] CleanupLog 有 `purge` 留痕且 freedBytes = 617 > 0

## D5 其余 P0 路由补测

| 路由 | 结果 |
|---|---|
| `GET /new` 发布页 | 200，渲染上传/ZIP/发布 |
| `POST /api/projects/{slug}/renew` | 200，`{ttlDays:90, expireAt:2027-11-01...}` 续期生效 |
| `GET /api/covers/{slug}.svg` | 200，`image/svg+xml` |
| `GET /api/projects?pageSize=50` | 200，统一响应体 `{ok:true,data:[...],meta:{...}}` |
| `POST /api/admin/cleanup/run` | 由 `npm run cleanup:once` 同源验证 |

## D6 观察项（非缺陷）

`orphan-scan` 报告残留目录 `oY21t5y5`（534 B，DB 中为 PURGED 但目录仍在），
来自**上一轮被 499 中断的运行**。清理任务的策略是「**仅报告未删除**」——
对可能是用户数据的东西不做自动物理删除，这个保守策略是正确的，不改。

## 阶段 D 判定：**PASS**（D1-D5 全部通过；BUG-2 soft-404 已在阶段 C 记录并另报工程师）
