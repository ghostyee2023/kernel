/**
 * P1 收尾 QA 独立验证 —— 前端/契约静态核对（在编译器无法运行的受限环境下，
 * 以源码断言 + 服务层/Handler 层实测共同完成验收）。
 *
 * 断言「已拍板产品规则」对应的关键产物存在于源码：
 *   - /new 未登录引导卡文案与跳转
 *   - 发布向导上传模式 tabs
 *   - Nav 排行榜 href=/rank
 *   - 状态页 canManage 条件渲染
 *   - 排行榜 page：podium / medal / 空态文案 / 榜单项链向详情页
 *   - rank() 口径（PUBLIC+ACTIVE+voteCount>0、排序）
 *   - 鉴权边界（requireUser 先行、authorId 会话注入、FORBIDDEN 判定）
 *   - /_status rewrite
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

let ROOT = new URL('../../', import.meta.url).pathname;
// Windows pathname 形如 /D:/work/...，去掉前导斜杠
if (/^\/[A-Za-z]:\//.test(ROOT)) ROOT = ROOT.slice(1);
function read(rel: string): string {
  return readFileSync(`${ROOT}${rel}`, 'utf8');
}

test('S1 /new 未登录引导卡：文案「登录后即可发布作品」+ /login?next=/new', () => {
  const src = read('src/app/new/page.tsx');
  assert.match(src, /登录后即可发布作品/);
  assert.match(src, /发布前先登录/);
  assert.match(src, /\/login\?next=\/new/);
  assert.match(src, /session \? <UploadWizard \/> : <LoginGuide \/>/);
});

test('S2 发布向导：上传模式 tabs（ZIP 压缩包 / 单个 HTML / 外部链接）', () => {
  const wizard = read('src/components/upload/UploadWizard.tsx');
  const tabs = read('src/components/upload/UploadModeTabs.tsx');
  assert.match(wizard, /UploadModeTabs/);
  assert.match(tabs, /ZIP 压缩包/);
  assert.match(tabs, /单个 HTML/);
  assert.match(tabs, /外部链接/);
  assert.match(tabs, /aria-label="上传方式"/);
});

test('S3 Nav：排行榜 href=/rank 且非 disabled；活动入口已启用（P1 活动模块）', () => {
  const src = read('src/components/ui/Nav.tsx');
  assert.match(src, /href: '\/rank'/);
  assert.match(src, /label: '排行榜'/);
  // P1 活动模块：活动入口由 disabled 激活为 /campaigns
  assert.match(src, /href: '\/campaigns', label: '活动'/);
  assert.doesNotMatch(src, /href: '\/campaigns', label: '活动', disabled: true/);
  // P3 个人空间（Q10）：「我的作品」已启用为 /dashboard，所有角色可见（非 ADMIN 专属）
  assert.match(src, /href: '\/dashboard', label: '我的作品'/);
  assert.doesNotMatch(src, /href: '\/dashboard', label: '我的作品', disabled: true/);
});

test('S4 状态页：canManage 才渲染操作区', () => {
  const src = read('src/app/status/[slug]/page.tsx');
  assert.match(src, /canManage = isAdminRole\(session\?\.role\) \|\| project\.authorId === session\?\.userId/);
  assert.match(src, /!purged && canManage/);
  assert.match(src, /ProjectActions/);
});

test('S5 排行榜页：podium 2/1/3 + medal 三色 + 空态文案 + 榜单项链向详情页', () => {
  const src = read('src/app/rank/page.tsx');
  assert.match(src, /gold.*silver.*bronze/s, 'MEDAL_TONE 含三色');
  assert.match(src, /medal--\$\{MEDAL_TONE\[rank - 1\]\}/);
  assert.match(src, /还没有作品获得投票/);
  assert.match(src, /2\/1\/3/);
  assert.match(src, /rank: 2, project: top3\[1\]/);
  assert.match(src, /rank: 1, project: top3\[0\]/);
  assert.match(src, /rank: 3, project: top3\[2\]/);
  // 榜单项整块 Link 指向 detailUrl（/w/[slug]）
  assert.match(src, /href=\{project\.detailUrl\}/);
});

test('S6 rank() 口径：PUBLIC + ACTIVE + voteCount>0，按 voteCount desc, createdAt desc', () => {
  const src = read('src/lib/project-service.ts');
  const seg = src.slice(src.indexOf('export async function rank'));
  assert.match(seg, /visibility: VISIBILITY\.PUBLIC/);
  assert.match(seg, /status: PROJECT_STATUS\.ACTIVE/);
  assert.match(seg, /voteCount: \{ gt: 0 \}/);
  assert.match(seg, /stats: \{ voteCount: 'desc' \}/);
  assert.match(seg, /createdAt: 'desc'/);
});

test('S7 POST /api/projects：requireUser 先行 + authorId 来自会话', () => {
  const src = read('src/app/api/projects/route.ts');
  assert.match(src, /const session = await requireUser\(\)/);
  assert.match(src, /authorId: session\.userId/);
});

test('S8 PATCH/DELETE/renew：requireUser + 非作者非 ADMIN → FORBIDDEN', () => {
  const slugRoute = read('src/app/api/projects/[slug]/route.ts');
  assert.match(slugRoute, /await requireUser\(\)/);
  assert.match(slugRoute, /canManageProject/);
  assert.match(slugRoute, /ERROR_CODE\.FORBIDDEN/);
  const renew = read('src/app/api/projects/[slug]/renew/route.ts');
  assert.match(renew, /await requireUser\(\)/);
  assert.match(renew, /canManageProject/);
  assert.match(renew, /ERROR_CODE\.FORBIDDEN/);
});

test('S9 canManageProject：作者本人或 ADMIN', () => {
  const src = read('src/lib/auth.ts');
  assert.match(src, /project\.authorId === session\.userId \|\| isAdminRole\(session\.role\)/);
});

test('S10 三个上传 API 均 requireUser 先行', () => {
  for (const rel of [
    'src/app/api/projects/upload-init/route.ts',
    'src/app/api/projects/upload-chunk/route.ts',
    'src/app/api/projects/upload-complete/route.ts',
  ]) {
    const src = read(rel);
    assert.match(src, /await requireUser\(\)/, rel);
  }
});

test('S11 /_status rewrite：/_status/:slug → /status/:slug', () => {
  const cfg = read('next.config.ts');
  assert.match(cfg, /source: '\/_status\/:slug'/);
  assert.match(cfg, /destination: '\/status\/:slug'/);
});

test('S12 排行榜样式在 globals.css 落地', () => {
  const css = read('src/styles/globals.css');
  assert.match(css, /\.rank-page/);
  assert.match(css, /\.podium/);
  assert.match(css, /\.medal--gold/);
  assert.match(css, /\.ranklist-row/);
  assert.match(css, /\.empty/);
});

test('S13 上传向导 401 处理：NOT_LOGGED_IN → 跳登录', () => {
  const src = read('src/components/upload/UploadWizard.tsx');
  assert.match(src, /error\.code === 'NOT_LOGGED_IN'/);
  assert.match(src, /\/login\?next=\/new/);
});

test('S14 ProjectActions：canManage=false 整块不渲染', () => {
  const src = read('src/components/project/ProjectActions.tsx');
  assert.match(src, /if \(!canManage\) return null/);
});

test('S15 ProjectDTO 含 authorId / authorName', () => {
  const src = read('src/lib/types.ts');
  assert.match(src, /authorId: string/);
  assert.match(src, /authorName: string/);
});
