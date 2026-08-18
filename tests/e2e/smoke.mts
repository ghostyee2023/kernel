/**
 * 端到端冒烟：对真实运行中的 dev server 发起 HTTP 请求，
 * 验证 P0 主链路「传 zip → 得短链 → 打开能跑 → 隔离 → 到期下线」。
 *
 * 运行前提：dev server 已在 BASE 指定端口就绪。
 */

import * as path from 'node:path';

import { buildZip, DEMO_HTML } from '../helpers/zip-builder';
import { prisma } from '../../src/lib/prisma';
import { resolveProjectDir } from '../../src/lib/storage';
import * as fs from 'node:fs/promises';

const BASE = process.env.QA_BASE ?? 'http://localhost:3131';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1;
    console.log('  PASS  ' + label);
  } else {
    failed += 1;
    failures.push(label + (detail ? ' — ' + detail : ''));
    console.log('  FAIL  ' + label + (detail ? '  << ' + detail : ''));
  }
}

function section(title: string): void {
  console.log('\n===== ' + title + ' =====');
}

/* ========================================================================== */
section('E2E-1  首页 /');

const home = await fetch(BASE + '/');
const homeHtml = await home.text();
check('GET / → 200', home.status === 200, 'status=' + home.status);
check('首页含 Hero 文案「每一件杰作，都始于一颗种子」',
  homeHtml.includes('每一件杰作，都始于一颗种子'));
check('首页渲染出 seed 作品卡片（/w/ 链接）', /\/w\/[A-Za-z0-9]{6,}/.test(homeHtml));

/* ========================================================================== */
section('E2E-2  作品详情页 /w/[slug]');

const seed = await prisma.project.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
if (!seed) throw new Error('没有可用的 seed 作品，请先执行 prisma db seed');
console.log('  使用 seed 作品 slug=' + seed.slug);

const detail = await fetch(BASE + '/w/' + seed.slug);
const detailHtml = await detail.text();
check('GET /w/{slug} → 200', detail.status === 200, 'status=' + detail.status);
check('详情页含 <iframe>', detailHtml.includes('<iframe'));
check('iframe 指向 /sandbox/{slug}', detailHtml.includes('/sandbox/' + seed.slug));
check('iframe 带 sandbox 属性且不含 allow-same-origin',
  /sandbox="[^"]*allow-scripts[^"]*"/.test(detailHtml) && !detailHtml.includes('allow-same-origin'));

const notFoundPage = await fetch(BASE + '/w/zzzNoSuch');
check('GET /w/{不存在} → 404', notFoundPage.status === 404, 'status=' + notFoundPage.status);

/* ========================================================================== */
section('E2E-3  沙箱隔离 /sandbox/[slug]');

// 注意：带尾斜杠的 /sandbox/{slug}/ 会被 Next 308 重定向到无尾斜杠形式，
// 因此这里对规范形式做头部断言，尾斜杠行为另行单独记录。
const slashProbe = await fetch(BASE + '/sandbox/' + seed.slug + '/', { redirect: 'manual' });
console.log('  [观察] /sandbox/{slug}/ → ' + slashProbe.status
  + ' → ' + (slashProbe.headers.get('location') ?? '-'));

const sb = await fetch(BASE + '/sandbox/' + seed.slug);
const csp = sb.headers.get('content-security-policy') ?? '';
check('GET /sandbox/{slug} → 200', sb.status === 200, 'status=' + sb.status);
check('CSP 含 sandbox 指令', csp.includes('sandbox'));
check('CSP 的 sandbox 不含 allow-same-origin  ★隔离红线', !csp.includes('allow-same-origin'));
check('CSP 含 form-action \'none\'', csp.includes("form-action 'none'"));
check('无 Set-Cookie  ★隔离红线', sb.headers.get('set-cookie') === null,
  'set-cookie=' + sb.headers.get('set-cookie'));
check('X-Content-Type-Options: nosniff', sb.headers.get('x-content-type-options') === 'nosniff');
check('Referrer-Policy 存在', (sb.headers.get('referrer-policy') ?? '') !== '');
check('Permissions-Policy 存在', (sb.headers.get('permissions-policy') ?? '') !== '');
check('Cross-Origin-Opener-Policy 存在', (sb.headers.get('cross-origin-opener-policy') ?? '') !== '');
check('Cross-Origin-Resource-Policy 存在', (sb.headers.get('cross-origin-resource-policy') ?? '') !== '');
check('X-Robots-Tag 含 noindex', (sb.headers.get('x-robots-tag') ?? '').includes('noindex'));
const sbBody = (await sb.text()).toLowerCase();
check('沙箱直出真实 HTML 内容', sbBody.includes('<html') || sbBody.includes('<!doctype'),
  'head=' + sbBody.slice(0, 80));
check('沙箱 Content-Type 为 text/html', (sb.headers.get('content-type') ?? '').includes('text/html'),
  'ct=' + sb.headers.get('content-type'));

const headRes = await fetch(BASE + '/sandbox/' + seed.slug + '/', { method: 'HEAD' });
check('HEAD /sandbox/{slug}/ → 200 且同样带 CSP', headRes.status === 200
  && (headRes.headers.get('content-security-policy') ?? '').includes('sandbox'));

// 路径穿越 / 越权
const trav = await fetch(BASE + '/sandbox/' + seed.slug + '/../../prisma/dev.db', { redirect: 'manual' });
check('沙箱路径穿越 → 非 200（403/404）  ★隔离红线', trav.status !== 200, 'status=' + trav.status);

const dotKernel = await fetch(BASE + '/sandbox/' + seed.slug + '/.kernel/meta.json');
check('访问 .kernel 元数据 → 403', dotKernel.status === 403, 'status=' + dotKernel.status);

const missing = await fetch(BASE + '/sandbox/' + seed.slug + '/no-such-file.html');
check('访问不存在的文件 → 404', missing.status === 404, 'status=' + missing.status);

const badSlug = await fetch(BASE + '/sandbox/zzzNoSuch/');
check('访问不存在的作品 → 404', badSlug.status === 404, 'status=' + badSlug.status);

/* ========================================================================== */
section('E2E-4  三段式上传 → 发布 → 短链可访问');

const zipBuf = buildZip([
  { name: 'index.html', data: DEMO_HTML },
  { name: 'assets/style.css', data: 'body{background:#0b0b0f;color:#fff}' },
  { name: 'assets/app.js', data: 'console.log("kernel e2e")' },
]);
console.log('  构造 ZIP 体积=' + zipBuf.byteLength + 'B');

const initRes = await fetch(BASE + '/api/projects/upload-init', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fileName: 'e2e-demo.zip', fileSize: zipBuf.byteLength, mode: 'ZIP' }),
});
const initJson = await initRes.json() as { ok: boolean; data?: { uploadId: string; totalChunks: number } };
check('upload-init → 201 且信封为 {ok:true,data}', initRes.status === 201 && initJson.ok === true,
  'status=' + initRes.status + ' body=' + JSON.stringify(initJson).slice(0, 200));

const uploadId = initJson.data?.uploadId ?? '';
check('返回 uploadId', uploadId !== '');

const form = new FormData();
form.set('uploadId', uploadId);
form.set('index', '0');
form.set('chunk', new Blob([new Uint8Array(zipBuf)]), 'chunk-0');
const chunkRes = await fetch(BASE + '/api/projects/upload-chunk', { method: 'POST', body: form });
const chunkJson = await chunkRes.json() as { ok: boolean; data?: { received: number; total: number } };
check('upload-chunk → 200 且分片计数正确', chunkRes.status === 200 && chunkJson.ok === true
  && chunkJson.data?.received === chunkJson.data?.total,
  JSON.stringify(chunkJson).slice(0, 200));

const completeRes = await fetch(BASE + '/api/projects/upload-complete', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ uploadId }),
});
const completeJson = await completeRes.json() as {
  ok: boolean;
  data?: { fileCount: number; entryFileSuggested: string; sizeBytes: number };
};
check('upload-complete → 200', completeRes.status === 200 && completeJson.ok === true,
  JSON.stringify(completeJson).slice(0, 300));
check('识别出 3 个文件', completeJson.data?.fileCount === 3, 'fileCount=' + completeJson.data?.fileCount);
check('入口文件为 index.html', completeJson.data?.entryFileSuggested === 'index.html',
  'entry=' + completeJson.data?.entryFileSuggested);

const createRes = await fetch(BASE + '/api/projects', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ uploadId, title: 'QA 端到端冒烟作品', summary: '由 QA 自动化创建', ttlDays: 90 }),
});
const createJson = await createRes.json() as {
  ok: boolean;
  data?: { slug: string; sandboxUrl: string; detailUrl: string; expireAt: string };
};
check('POST /api/projects → 201', createRes.status === 201 && createJson.ok === true,
  JSON.stringify(createJson).slice(0, 300));

const newSlug = createJson.data?.slug ?? '';
check('返回 8 位 Base58 短码', /^[1-9A-HJ-NP-Za-km-z]{8}$/.test(newSlug), 'slug=' + newSlug);
check('短码不含易混字符 0OIl', !/[0OIl]/.test(newSlug), 'slug=' + newSlug);
check('返回 sandboxUrl 指向 /sandbox/{slug}',
  (createJson.data?.sandboxUrl ?? '').includes('/sandbox/' + newSlug),
  createJson.data?.sandboxUrl);
check('返回 detailUrl 指向 /w/{slug}',
  (createJson.data?.detailUrl ?? '').includes('/w/' + newSlug), createJson.data?.detailUrl);

const expireAt = createJson.data?.expireAt ? new Date(createJson.data.expireAt) : null;
const days = expireAt ? Math.round((expireAt.getTime() - Date.now()) / 86400000) : -1;
check('默认有效期 90 天（±1 天）', days >= 89 && days <= 91, 'days=' + days);

// —— 新作品必须真的能打开 ——
const newSandbox = await fetch(BASE + '/sandbox/' + newSlug);
const newHtml = await newSandbox.text();
check('★ 新作品沙箱 200 且返回上传的 HTML', newSandbox.status === 200 && newHtml.includes('Kernel'),
  'status=' + newSandbox.status + ' head=' + newHtml.slice(0, 80));
check('新作品沙箱同样无 Set-Cookie', newSandbox.headers.get('set-cookie') === null);

const newCss = await fetch(BASE + '/sandbox/' + newSlug + '/assets/style.css');
check('子资源 assets/style.css 可访问且 MIME 正确',
  newCss.status === 200 && (newCss.headers.get('content-type') ?? '').includes('text/css'),
  'status=' + newCss.status + ' ct=' + newCss.headers.get('content-type'));

const newDetail = await fetch(BASE + '/w/' + newSlug);
check('新作品详情页 200', newDetail.status === 200, 'status=' + newDetail.status);

/* ========================================================================== */
section('E2E-5  安全流水线在真实 HTTP 链路上的拦截');

/** 走完 init+chunk+complete，返回 complete 的响应。 */
async function uploadAndComplete(fileName: string, buf: Buffer): Promise<{ status: number; body: string }> {
  const i = await fetch(BASE + '/api/projects/upload-init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName, fileSize: buf.byteLength, mode: 'ZIP' }),
  });
  const ij = await i.json() as { data?: { uploadId: string } };
  const id = ij.data?.uploadId ?? '';
  const f = new FormData();
  f.set('uploadId', id);
  f.set('index', '0');
  f.set('chunk', new Blob([new Uint8Array(buf)]), 'c0');
  await fetch(BASE + '/api/projects/upload-chunk', { method: 'POST', body: f });
  const c = await fetch(BASE + '/api/projects/upload-complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uploadId: id }),
  });
  return { status: c.status, body: await c.text() };
}

// 压缩比炸弹（声明 500MB）
const bomb = buildZip([
  { name: 'index.html', data: DEMO_HTML },
  { name: 'bomb.txt', data: 'A'.repeat(2000), fakeUncompressedSize: 500 * 1024 * 1024 },
]);
const bombRes = await uploadAndComplete('bomb.zip', bomb);
check('★ 压缩炸弹被 HTTP 层拒绝（非 2xx）', bombRes.status >= 400,
  'status=' + bombRes.status + ' body=' + bombRes.body.slice(0, 160));
check('炸弹返回受控错误码（非 INTERNAL_ERROR）', !bombRes.body.includes('INTERNAL_ERROR'),
  bombRes.body.slice(0, 160));

// zip-slip 穿越
const slip = buildZip([
  { name: 'index.html', data: DEMO_HTML },
  { name: '../../evil.html', data: '<script>alert(1)</script>' },
]);
const slipRes = await uploadAndComplete('slip.zip', slip);
check('★ zip-slip 被 HTTP 层拒绝', slipRes.status >= 400,
  'status=' + slipRes.status + ' body=' + slipRes.body.slice(0, 160));
const escaped = path.resolve(process.cwd(), '.kernel-data', 'evil.html');
check('宿主机未被写入逃逸文件',
  !(await fs.access(escaped).then(() => true).catch(() => false)));

// 无 HTML 入口
const noEntry = buildZip([{ name: 'readme.md', data: '# hi' }]);
const noEntryRes = await uploadAndComplete('no-entry.zip', noEntry);
check('无入口文件的包被拒绝', noEntryRes.status >= 400,
  'status=' + noEntryRes.status + ' body=' + noEntryRes.body.slice(0, 160));

// 假 ZIP（改名的 PE 文件）
const fakeZip = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(600, 0x90)]);
const fakeRes = await uploadAndComplete('fake.zip', fakeZip);
check('改名的非 ZIP 文件被魔数识别拒绝', fakeRes.status >= 400,
  'status=' + fakeRes.status + ' body=' + fakeRes.body.slice(0, 160));
check('假 ZIP 返回 UNSUPPORTED_FILE_TYPE（非 500）',
  fakeRes.body.includes('UNSUPPORTED_FILE_TYPE'), fakeRes.body.slice(0, 200));

// 截断文件（复现 validate.ts 的 End-Of-Stream）
const truncPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const truncRes = await uploadAndComplete('trunc.zip', truncPng);
check('截断文件被拒绝', truncRes.status >= 400, 'status=' + truncRes.status);
check('★ 截断文件应返回 UNSUPPORTED_FILE_TYPE 而非 500 INTERNAL_ERROR',
  truncRes.status !== 500 && !truncRes.body.includes('INTERNAL_ERROR'),
  'status=' + truncRes.status + ' body=' + truncRes.body.slice(0, 200));

/* ========================================================================== */
section('E2E-6  统一响应信封');

const badJson = await fetch(BASE + '/api/projects/upload-init', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json',
});
const badBody = await badJson.json() as { ok: boolean; error?: { code: string; message: string } };
check('错误信封为 {ok:false,error:{code,message}}',
  badBody.ok === false && typeof badBody.error?.code === 'string' && typeof badBody.error?.message === 'string',
  JSON.stringify(badBody));
check('参数错误 → 400', badJson.status === 400, 'status=' + badJson.status);

const getList = await fetch(BASE + '/api/projects');
const listBody = await getList.json() as { ok: boolean; data?: unknown; meta?: unknown };
check('GET /api/projects → {ok:true,data}', getList.status === 200 && listBody.ok === true,
  JSON.stringify(listBody).slice(0, 160));

const getOne = await fetch(BASE + '/api/projects/' + newSlug);
check('GET /api/projects/{slug} → 200', getOne.status === 200, 'status=' + getOne.status);
const getMissing = await fetch(BASE + '/api/projects/zzzNoSuch');
check('GET /api/projects/{不存在} → 404', getMissing.status === 404, 'status=' + getMissing.status);

/* ========================================================================== */
section('E2E-7  生命周期：ACTIVE → ARCHIVED → PURGED（90 天后自动下线）');

// 把新作品的 expireAt 拨到过去，模拟 90 天后
await prisma.project.update({
  where: { slug: newSlug },
  data: { expireAt: new Date(Date.now() - 86400000) },
});
console.log('  已将 ' + newSlug + ' 的 expireAt 拨到昨天');

const { runAll } = await import('../../src/lib/lifecycle');

const r1 = await runAll();
const afterArchive = await prisma.project.findUnique({ where: { slug: newSlug } });
check('★ 到期作品被归档 status=ARCHIVED', afterArchive?.status === 'ARCHIVED',
  'status=' + afterArchive?.status + ' reports=' + JSON.stringify(r1.reports));
check('归档后 purgeAt ≈ 30 天后', (() => {
  if (!afterArchive?.purgeAt) return false;
  const d = Math.round((afterArchive.purgeAt.getTime() - Date.now()) / 86400000);
  return d >= 29 && d <= 31;
})(), 'purgeAt=' + afterArchive?.purgeAt?.toISOString());

const dir = resolveProjectDir(newSlug);
check('归档后磁盘目录仍保留（回收站期可复活）',
  await fs.access(dir).then(() => true).catch(() => false));

// 归档后短链行为：详情页仍在，沙箱跳状态页
const archivedSandbox = await fetch(BASE + '/sandbox/' + newSlug, { redirect: 'manual' });
check('归档后访问沙箱 → 重定向到状态页（不再直出内容）',
  archivedSandbox.status === 302 || archivedSandbox.status === 307 || archivedSandbox.status === 404,
  'status=' + archivedSandbox.status + ' loc=' + archivedSandbox.headers.get('location'));

// 把 purgeAt 拨到过去，模拟回收站 30 天后
await prisma.project.update({
  where: { slug: newSlug },
  data: { purgeAt: new Date(Date.now() - 86400000) },
});
const r2 = await runAll();
const afterPurge = await prisma.project.findUnique({ where: { slug: newSlug } });
check('★ 回收站到期后 status=PURGED', afterPurge?.status === 'PURGED',
  'status=' + afterPurge?.status + ' reports=' + JSON.stringify(r2.reports));
check('★ 磁盘目录被物理删除',
  !(await fs.access(dir).then(() => true).catch(() => false)));
check('DB 行保留（元数据留档、短码不复用）', afterPurge !== null);
const purgeReport = r2.reports.find((r) => r.action === 'purge');
check('purge 记账 freedBytes > 0', (purgeReport?.freedBytes ?? 0) > 0,
  'freed=' + purgeReport?.freedBytes);

const purgedDetail = await fetch(BASE + '/w/' + newSlug, { redirect: 'manual' });
check('已下线作品的详情页不再返回可用内容',
  purgedDetail.status === 404 || purgedDetail.status === 302 || purgedDetail.status === 307,
  'status=' + purgedDetail.status);

/* ========================================================================== */
console.log('\n============================================');
console.log('E2E 汇总：通过 ' + passed + ' / 失败 ' + failed);
if (failures.length > 0) {
  console.log('\n失败清单：');
  for (const f of failures) console.log('  ✖ ' + f);
}
console.log('============================================');

await prisma.$disconnect();
process.exit(failed > 0 ? 1 : 0);
