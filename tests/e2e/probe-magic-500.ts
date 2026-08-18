/**
 * 复现探针：validate.ts 的 `fileTypeFromBuffer` 未捕获异常 → HTTP 500。
 *
 * 输入是「已知魔数前缀但被截断」的字节流（真实用户传半个损坏文件时就会这样）。
 * 期望：400 UNSUPPORTED_FILE_TYPE；实际：500 INTERNAL_ERROR。
 */

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:3111';

async function upload(bytes: Buffer, fileName: string, mode: 'ZIP' | 'SINGLE_FILE') {
  const init = await fetch(`${BASE}/api/projects/upload-init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName, fileSize: bytes.byteLength, mode }),
  });
  const initJson = (await init.json()) as any;
  if (!init.ok) return { stage: 'init', status: init.status, json: initJson };

  const { uploadId, chunkSize, totalChunks } = initJson.data;
  for (let i = 0; i < totalChunks; i += 1) {
    const slice = bytes.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, bytes.byteLength));
    const form = new FormData();
    form.set('uploadId', uploadId);
    form.set('index', String(i));
    form.set('chunk', new Blob([new Uint8Array(slice)]), 'c.bin');
    const r = await fetch(`${BASE}/api/projects/upload-chunk`, { method: 'POST', body: form });
    if (!r.ok) return { stage: 'chunk', status: r.status, json: await r.json() };
  }

  const done = await fetch(`${BASE}/api/projects/upload-complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });
  return { stage: 'complete', status: done.status, json: await done.json() };
}

const CASES: Array<{ label: string; bytes: Buffer; name: string; mode: 'ZIP' | 'SINGLE_FILE' }> = [
  {
    label: '截断 PNG 魔数前缀（11 字节）',
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]),
    name: 'broken.html',
    mode: 'SINGLE_FILE',
  },
  {
    label: '截断 PNG 魔数前缀（ZIP 模式）',
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]),
    name: 'broken.zip',
    mode: 'ZIP',
  },
  {
    label: '截断 GIF 魔数前缀',
    bytes: Buffer.from('GIF89a\x01\x02', 'binary'),
    name: 'broken2.html',
    mode: 'SINGLE_FILE',
  },
  {
    label: '对照：纯文本（非魔数）',
    bytes: Buffer.from('hello world, plain text', 'utf8'),
    name: 'plain.html',
    mode: 'SINGLE_FILE',
  },
  {
    label: '对照：正常 HTML',
    bytes: Buffer.from('<!doctype html><html><body><h1>ok</h1></body></html>', 'utf8'),
    name: 'good.html',
    mode: 'SINGLE_FILE',
  },
];

async function main() {
  let bug = 0;
  for (const c of CASES) {
    const r = await upload(c.bytes, c.name, c.mode);
    const code = r.json?.error?.code ?? r.json?.code ?? '(none)';
    const flag = r.status >= 500 ? '  <== HTTP 5xx（缺陷）' : '';
    if (r.status >= 500) bug += 1;
    console.log(
      `${String(r.status).padEnd(4)} ${String(code).padEnd(24)} ${c.label} [${c.mode}]${flag}`,
    );
  }
  console.log(`\n5xx 用例数：${bug}/${CASES.length}`);
}

main().catch((e) => {
  console.error('PROBE_CRASHED:', e);
  process.exitCode = 2;
});
