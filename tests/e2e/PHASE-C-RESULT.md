# 阶段 C — 沙箱路由安全（留痕）

服务器：`next start -p 3111`（production build），数据：seed 3 demo + QA 夹具 `QaPriv01`(PRIVATE)

## C1 沙箱响应头（PUBLIC / UNLISTED 均验证）

`GET /sandbox/Aur9raFx` → 200

```
content-security-policy: sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms; form-action 'none'
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: cross-origin
permissions-policy: camera=(), microphone=(), geolocation=(), payment=()
referrer-policy: no-referrer
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
x-robots-tag: noindex, nofollow
cache-control: no-store, must-revalidate
```

- [x] 含 `Content-Security-Policy: sandbox ...`
- [x] **不含** `allow-same-origin`
- [x] 含 `form-action 'none'`（额外加固）
- [x] `Set-Cookie` 计数 = 0
- [x] 安全头齐全（8 条，超出要求的 6 条）

## C2 越权访问

| 用例 | 期望 | 实际 | 结论 |
|---|---|---|---|
| `/sandbox/QaPriv01`（PRIVATE） | 404 | 404 | PASS |
| `/sandbox/zzzzzzzz`（不存在） | 404 | 404 | PASS |

## C3 路径穿越

| 用例 | 期望 | 实际 | 结论 |
|---|---|---|---|
| `/sandbox/Aur9raFx/%2e%2e/%2e%2e/package.json` | 拒绝 | 404（URL 归一后不再命中沙箱路由） | PASS |
| `/sandbox/Aur9raFx/sub/%2e%2e%2f%2e%2e%2fpackage.json`（编码斜杠） | 403 | 403 | PASS |
| `/sandbox/Aur9raFx/.env` | 403 | 403 | PASS |
| `/sandbox/Aur9raFx/.git/config` | 403 | 403 | PASS |

## C4 附带发现（超出本阶段要求范围）

`notFound()` 在 `/w/[slug]`、`/status/[slug]` 上返回 **HTTP 200**（soft-404），页面内容正确渲染
自定义 404 UI（含「作品不存在 / 回到作品广场」）。

- `/definitely-nothing-here`（Next 内建未匹配）→ 404 ✅
- `/w/zzzzzzzz` → 200 ❌（`Transfer-Encoding: chunked`）
- `/w/QaPriv01`（PRIVATE）→ 200 ❌
- `/status/zzzzzzzz` / `/_status/zzzzzzzz` → 200 ❌（rewrite 本身可达 ✅）

根因：根级 `src/app/loading.tsx` 制造了根 Suspense 边界，配合页面的
`export const dynamic = 'force-dynamic'` 触发流式 SSR，响应壳体在 `notFound()`
执行前就以 200 冲刷，状态码无法再改写。

注：**不构成存在性泄漏**（PRIVATE 与不存在表现完全一致），但违反 HTTP 语义。

## 阶段 C 判定：**PASS**（team-lead 列出的验证点全部通过；C4 为附加缺陷，另报工程师）
