/**
 * 阶段 D 端到端冒烟：构造真实 ZIP → upload-init / upload-chunk / upload-complete
 * → POST /api/projects → 断言短链可访问、沙箱安全头齐全。
 *
 * 纯 HTTP 黑盒，不 import 任何 src 内部实现。
 */

import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:3111';
const OUT_DIR = path.resolve(process.cwd(), '.qa-out');

/* ------------------------------------------------------------------ *
 * 最小 ZIP 构造器（本地文件头 + 中央目录 + EOCD，deflate 压缩）
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const comp = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method = deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x2100, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x2100, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push(local, comp);
    centrals.push(central);
    offset += local.length + comp.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/* ------------------------------------------------------------------ */

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function record(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, ok: true, detail: '' });
    console.log(`  PASS  ${name}`);
  } catch (e) {
    const detail = e instanceof Error ? e.message.split('\n')[0] : String(e);
    results.push({ name, ok: false, detail });
    console.log(`  FAIL  ${name}\n        ${detail}`);
  }
}

async function uploadZip(zip: Buffer, fileName: string, mode: 'ZIP' | 'SINGLE_FILE') {
  const initRes = await fetch(`${BASE}/api/projects/upload-init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName, fileSize: zip.byteLength, mode }),
  });
  const initJson = (await initRes.json()) as any;
  if (!initRes.ok) {
    return { failed: true as const, status: initRes.status, json: initJson };
  }

  const { uploadId, chunkSize, totalChunks } = initJson.data;

  for (let i = 0; i < totalChunks; i += 1) {
    const slice = zip.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, zip.byteLength));
    const form = new FormData();
    form.set('uploadId', uploadId);
    form.set('index', String(i));
    form.set('chunk', new Blob([new Uint8Array(slice)]), 'chunk.bin');
    const chunkRes = await fetch(`${BASE}/api/projects/upload-chunk`, { method: 'POST', body: form });
    const chunkJson = (await chunkRes.json()) as any;
    if (!chunkRes.ok) return { failed: true as const, status: chunkRes.status, json: chunkJson };
  }

  const completeRes = await fetch(`${BASE}/api/projects/upload-complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });
  const completeJson = (await completeRes.json()) as any;
  return {
    failed: !completeRes.ok,
    status: completeRes.status,
    json: completeJson,
    uploadId,
    initMeta: { chunkSize, totalChunks },
  } as any;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log('\n【D3-1】正常 ZIP 走完三段式上传');

  const html = Buffer.from(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>QA 冒烟作品</title>
<link rel="stylesheet" href="style.css"></head>
<body><h1 id="t">QA-E2E-SMOKE-OK</h1><script src="app.js"></script></body></html>`,
    'utf8',
  );
  const css = Buffer.from('body{background:#0b0b0f;color:#e8e8ef;font-family:system-ui}\n', 'utf8');
  const js = Buffer.from("document.getElementById('t').dataset.ready='1';\n", 'utf8');

  const goodZip = buildZip([
    { name: 'index.html', data: html },
    { name: 'style.css', data: css },
    { name: 'app.js', data: js },
  ]);
  await writeFile(path.join(OUT_DIR, 'good.zip'), goodZip);

  const good = await uploadZip(goodZip, 'qa-smoke.zip', 'ZIP');
  record('upload-complete 返回 2xx', () => {
    assert.equal(good.failed, false, `status=${good.status} body=${JSON.stringify(good.json)}`);
  });
  record('校验结果含 3 个文件且入口为 index.html', () => {
    assert.equal(good.json.data.fileCount, 3);
    assert.equal(good.json.data.entryFileSuggested, 'index.html');
  });

  console.log('\n【D3-2】POST /api/projects 创建作品');
  const createRes = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      uploadId: good.uploadId,
      title: 'QA 端到端冒烟作品',
      summary: '由 QA 自动化构造的 ZIP 作品',
      visibility: 'PUBLIC',
      ttlDays: 30,
      authorAlias: 'qa-bot',
    }),
  });
  const createJson = (await createRes.json()) as any;
  record('创建作品返回 201', () => {
    assert.equal(createRes.status, 201, JSON.stringify(createJson));
  });

  const slug: string = createJson?.data?.slug ?? '';
  record('返回合法 8 位 Base58 slug', () => {
    assert.match(slug, /^[1-9A-HJ-NP-Za-km-z]{8}$/, `slug=${slug}`);
  });
  record('返回 sandboxUrl / detailUrl', () => {
    assert.ok(String(createJson?.data?.sandboxUrl ?? '').includes(slug));
    assert.ok(String(createJson?.data?.detailUrl ?? '').includes(slug));
  });
  console.log(`        slug=${slug} sandboxUrl=${createJson?.data?.sandboxUrl}`);

  console.log('\n【D3-3】新作品沙箱可访问 + 安全头');
  const sbRes = await fetch(`${BASE}/sandbox/${slug}`, { redirect: 'follow' });
  const sbBody = await sbRes.text();
  record('沙箱返回 200', () => assert.equal(sbRes.status, 200));
  record('沙箱返回上传的真实内容', () => assert.ok(sbBody.includes('QA-E2E-SMOKE-OK'), sbBody.slice(0, 200)));
  record('CSP sandbox 且无 allow-same-origin', () => {
    const csp = sbRes.headers.get('content-security-policy') ?? '';
    assert.match(csp, /sandbox\s/, `csp=${csp}`);
    assert.ok(!csp.includes('allow-same-origin'), `csp=${csp}`);
  });
  record('无 Set-Cookie', () => assert.equal(sbRes.headers.get('set-cookie'), null));
  for (const h of [
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
    'x-robots-tag',
  ]) {
    record(`安全头 ${h} 存在`, () => assert.ok(sbRes.headers.get(h), `${h} 缺失`));
  }

  console.log('\n【D3-4】静态子资源可访问且不越界');
  const cssRes = await fetch(`${BASE}/sandbox/${slug}/style.css`);
  record('子资源 style.css 200', () => assert.equal(cssRes.status, 200));
  const escRes = await fetch(`${BASE}/sandbox/${slug}/..%2f..%2fpackage.json`);
  record('子路径穿越被拒（4xx）', () => assert.ok(escRes.status >= 400, `status=${escRes.status}`));

  console.log('\n【D3-5】ZIP 安全流水线（HTTP 层）');
  const slipZip = buildZip([
    { name: 'index.html', data: html },
    { name: '../../evil.html', data: Buffer.from('<h1>pwn</h1>') },
  ]);
  const slip = await uploadZip(slipZip, 'slip.zip', 'ZIP');
  record('zip-slip 条目被拒或被忽略', () => {
    const treeStr = JSON.stringify(slip.json?.data ?? {});
    assert.ok(slip.failed || !treeStr.includes('evil.html'), `resp=${treeStr.slice(0, 300)}`);
  });

  const bomb = buildZip([
    { name: 'index.html', data: html },
    { name: 'big.txt', data: Buffer.alloc(80 * 1024 * 1024, 0x41) },
  ]);
  const bombRes = await uploadZip(bomb, 'bomb.zip', 'ZIP');
  record('解压炸弹（比率/单条目超限）被拒', () => {
    assert.equal(bombRes.failed, true, `resp=${JSON.stringify(bombRes.json).slice(0, 300)}`);
  });
  record('炸弹被拒时错误码为业务码而非 500', () => {
    assert.ok(bombRes.status < 500, `status=${bombRes.status} body=${JSON.stringify(bombRes.json).slice(0, 300)}`);
  });
  console.log(`        bomb -> ${bombRes.status} ${JSON.stringify(bombRes.json?.error ?? bombRes.json).slice(0, 160)}`);

  const notZip = Buffer.from('this is definitely not a zip file, just plain ascii text.', 'utf8');
  const fake = await uploadZip(notZip, 'fake.zip', 'ZIP');
  record('伪造扩展名（非 ZIP 内容）被拒', () => assert.equal(fake.failed, true));
  record('伪造扩展名错误码 < 500', () => {
    assert.ok(fake.status < 500, `status=${fake.status} body=${JSON.stringify(fake.json).slice(0, 300)}`);
  });
  console.log(`        fake -> ${fake.status} ${JSON.stringify(fake.json?.error ?? fake.json).slice(0, 160)}`);

  await writeFile(
    path.join(OUT_DIR, 'smoke-upload-result.json'),
    JSON.stringify({ slug, results }, null, 2),
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 冒烟结果：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length > 0) {
    console.log('失败项：');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  console.log(`SMOKE_SLUG=${slug}`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('SMOKE_CRASHED:', e);
  process.exitCode = 2;
});
