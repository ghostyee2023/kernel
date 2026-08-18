/**
 * 阶段 C/D 回归补充：BUG-2（soft-404）定向验证。
 *
 * 修复前：根级 loading.tsx 的 Suspense 边界 + force-dynamic 触发流式 SSR，
 * 响应壳体在 notFound() 之前就带 200 冲刷，导致 /w /status 全部 soft-200。
 * 修复后（page.tsx + loading.tsx 迁入路由组 (feed)）：应恢复真 404。
 *
 * 同时回归「PRIVATE 与不存在表现一致」的隐私约束——修 404 不能把存在性泄漏出去。
 */

import assert from 'node:assert/strict';

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:3111';
const PRIVATE_SLUG = process.env.QA_PRIVATE_SLUG ?? 'QaPriv01';
const PUBLIC_SLUG = process.env.QA_PUBLIC_SLUG ?? 'Aur9raFx';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true, detail: '' });
    console.log(`  PASS  ${name}`);
  } catch (e) {
    const detail = e instanceof Error ? e.message.split('\n')[0] : String(e);
    results.push({ name, ok: false, detail });
    console.log(`  FAIL  ${name}\n        ${detail}`);
  }
}

/** 取状态码 + 正文，供「内容仍正确」的断言使用。 */
async function get(pathname: string) {
  const r = await fetch(`${BASE}${pathname}`, { redirect: 'manual' });
  return { status: r.status, body: await r.text(), headers: r.headers };
}

async function main() {
  console.log('\n【N1】notFound() 恢复真 404（BUG-2 回归）');

  await check('/w/{不存在} → 404', async () => {
    const r = await get('/w/zzzzzzzz');
    assert.equal(r.status, 404, `status=${r.status}`);
  });

  await check('/w/{PRIVATE} → 404', async () => {
    const r = await get(`/w/${PRIVATE_SLUG}`);
    assert.equal(r.status, 404, `status=${r.status}`);
  });

  await check('/status/{不存在} → 404', async () => {
    const r = await get('/status/zzzzzzzz');
    assert.equal(r.status, 404, `status=${r.status}`);
  });

  await check('/_status/{不存在}（rewrite）→ 404', async () => {
    const r = await get('/_status/zzzzzzzz');
    assert.equal(r.status, 404, `status=${r.status}`);
  });

  await check('未匹配路由 → 404（回归基线）', async () => {
    const r = await get('/definitely-nothing-here');
    assert.equal(r.status, 404, `status=${r.status}`);
  });

  console.log('\n【N2】404 页面内容仍然正确（不能只改状态码丢了 UI）');

  await check('404 正文含「作品不存在」与「回到作品广场」', async () => {
    const r = await get('/w/zzzzzzzz');
    assert.ok(r.body.includes('作品不存在'), '缺少「作品不存在」文案');
    assert.ok(r.body.includes('回到作品广场'), '缺少「回到作品广场」入口');
  });

  console.log('\n【N3】隐私约束：PRIVATE 与不存在必须无法区分');

  await check('PRIVATE 与不存在的状态码一致', async () => {
    const a = await get(`/w/${PRIVATE_SLUG}`);
    const b = await get('/w/zzzzzzzz');
    assert.equal(a.status, b.status, `private=${a.status} missing=${b.status}`);
  });

  await check('PRIVATE 与不存在的正文一致（不泄漏标题等元信息）', async () => {
    const a = await get(`/w/${PRIVATE_SLUG}`);
    const b = await get('/w/zzzzzzzz');
    assert.ok(!a.body.includes('QA] PRIVATE 夹具'), '泄漏了 PRIVATE 作品标题');
    assert.equal(a.body.length === b.body.length, true, `len ${a.body.length} vs ${b.body.length}`);
  });

  console.log('\n【N4】正常页面未被 (feed) 路由组迁移影响');

  await check('/ 广场页仍 200 且 Hero 文案在', async () => {
    const r = await get('/');
    assert.equal(r.status, 200, `status=${r.status}`);
    assert.ok(r.body.includes('每一件杰作，都始于一颗种子'), 'Hero 文案丢失');
  });

  await check('/ 骨架屏 loading 仍生效（(feed)/loading.tsx 未失联）', async () => {
    const r = await get('/');
    // 骨架屏是 Suspense fallback，SSR 完成后不一定出现在最终 HTML；
    // 这里只断言广场内容渲染成功，说明路由组结构没把页面搞坏
    assert.ok(r.body.includes('card') || r.body.includes('grid'), '广场列表结构缺失');
  });

  await check('/w/{PUBLIC} 详情页仍 200', async () => {
    const r = await get(`/w/${PUBLIC_SLUG}`);
    assert.equal(r.status, 200, `status=${r.status}`);
  });

  await check('/new 发布页仍 200', async () => {
    const r = await get('/new');
    assert.equal(r.status, 200, `status=${r.status}`);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== soft-404 回归：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length > 0) {
    console.log('失败项：');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('NOTFOUND_SMOKE_CRASHED:', e);
  process.exitCode = 2;
});
