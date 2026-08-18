/**
 * lib/upload/zip.ts + lib/upload/validate.ts 安全流水线测试。
 *
 * 对齐验收点（docs/P0-架构与任务分解.md T03）：
 *   ✅ 炸弹样本 → ZIP_BOMB_SUSPECTED，磁盘零残留
 *   ✅ 穿越样本 → 被拒绝，磁盘零残留
 *   ✅ 条目数 / 单条目体积越线 → 被拒绝
 *   ✅ 白名单外扩展名 → 忽略但不影响整包
 *   ✅ 正常 zip → 通过并正确解压
 *
 * 核心不变式：**任何拒绝路径都不得在目标目录留下一个字节。**
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES, MAX_ZIP_RATIO } from '../../src/lib/constants';
import { ERROR_CODE } from '../../src/lib/response';
import { dataRoot } from '../../src/lib/storage';
import {
  assertAllowedExt,
  assertPublicHttpUrl,
  assertRealType,
  filterEntries,
} from '../../src/lib/upload/validate';
import {
  buildFileTree,
  detectEntryFile,
  extractSafely,
  normalizeEntryName,
  prescan,
} from '../../src/lib/upload/zip';
import { buildNormalZip, buildZip, DEMO_HTML } from '../helpers/zip-builder';

/** 测试临时区（位于存储根内，便于用 storage 的删除 API 收尾）。 */
// 每次运行使用独立目录，避免与上一轮残留互相干扰。
// 目录落在 .kernel-data/tmp 下，由应用自身的 gcTmp 回收，
// 测试内部不做批量删除（沙箱对单回合大量 unlink 有阈值保护）。
const WORK_DIR = path.join(dataRoot(), 'tmp', `qa-zip-${process.pid}-${Date.now()}`);

/** 落盘一个 zip 并返回绝对路径。 */
async function putZip(name: string, buffer: Buffer): Promise<string> {
  const file = path.join(WORK_DIR, name);
  await fs.writeFile(file, buffer);
  return file;
}

/** 统计目录内文件数（目录不存在算 0）。 */
async function countFiles(dir: string): Promise<number> {
  let total = 0;
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(path.join(current, entry.name));
      else total += 1;
    }
  };
  await walk(dir);
  return total;
}

/**
 * 断言 prescan 拒绝该样本，并且目标目录零残留。
 *
 * @returns 捕获到的错误 code。
 */
let destSeq = 0;

async function expectRejectedWithNoResidue(zipPath: string, label: string): Promise<string> {
  // 每次用全新目录，无需预先删除（保证「零残留」断言依然严格）
  destSeq += 1;
  const dest = path.join(WORK_DIR, `dest-${destSeq}-${path.basename(zipPath)}`);

  let code = '';
  try {
    const scan = await prescan(zipPath);
    // 预扫描没拦住 → 让第二道防线（解压）来拦，但这本身已是设计退化
    await extractSafely(zipPath, dest, scan);
  } catch (error) {
    code = (error as { code?: string }).code ?? (error as Error).name;
  }

  assert.notEqual(code, '', `${label}：样本必须被拒绝，但流水线放行了`);
  assert.equal(await countFiles(dest), 0, `${label}：拒绝后目标目录必须零残留`);
  return code;
}

before(async () => {
  await fs.mkdir(WORK_DIR, { recursive: true });
});

after(async () => {
  // 刻意不做递归删除：产物留在 .kernel-data/tmp 下，
  // 交由应用的 gcTmp（超 TTL 自动回收）处理，同时便于失败时取证。
  console.log(`[qa][zip] 测试产物保留于 ${WORK_DIR}（由 gcTmp 回收）`);
});

/* ========================================================================== */

describe('zip · normalizeEntryName 条目名归一化（第一道防线）', () => {
  it('普通路径原样归一', () => {
    assert.equal(normalizeEntryName('index.html'), 'index.html');
    assert.equal(normalizeEntryName('assets/style.css'), 'assets/style.css');
    assert.equal(normalizeEntryName('assets\\img\\a.png'), 'assets/img/a.png');
    assert.equal(normalizeEntryName('./a/./b.js'), 'a/b.js');
  });

  const traversal: Array<[string, string]> = [
    ['../../evil.html', '验收用例：经典上跳'],
    ['..', '裸父目录'],
    ['a/../../b', '中途跳出'],
    ['..\\..\\evil.html', 'Windows 反斜杠上跳'],
    ['/etc/passwd', 'POSIX 绝对路径'],
    ['C:/Windows/win.ini', 'Windows 盘符'],
    ['D:\\evil.html', 'Windows 盘符 + 反斜杠'],
    ['a\0b', 'NUL 字节截断'],
  ];

  for (const [name, why] of traversal) {
    it(`拒绝 ${JSON.stringify(name)}（${why}）`, () => {
      assert.throws(
        () => normalizeEntryName(name),
        (error: { name?: string; code?: string }) =>
          error.name === 'AppError' && error.code === ERROR_CODE.PATH_TRAVERSAL_DETECTED,
        why,
      );
    });
  }
});

describe('zip · filterEntries 白名单过滤', () => {
  it('白名单内扩展名通过', () => {
    const { accepted, ignored } = filterEntries(['index.html', 'a.css', 'b.js', 'c.png', 'd.woff2']);
    assert.equal(accepted.length, 5);
    assert.equal(ignored.length, 0);
  });

  it('白名单外扩展名被忽略但不报错（含改名的可执行文件）', () => {
    const { accepted, ignored } = filterEntries([
      'index.html',
      'payload.exe',
      'shell.sh',
      'backdoor.php',
      'a.dll',
      'run.bat',
    ]);
    assert.deepEqual(accepted, ['index.html'], '只有 index.html 应被接受');
    assert.equal(ignored.length, 5);
    for (const item of ignored) {
      assert.equal(item.reason, 'EXTENSION_NOT_ALLOWED', `${item.path} 的忽略原因不符`);
    }
  });

  it('噪声目录整体忽略（__MACOSX / node_modules / .git / .kernel）', () => {
    const { accepted, ignored } = filterEntries([
      'index.html',
      '__MACOSX/._index.html',
      'node_modules/lodash/index.js',
      '.git/config',
      '.kernel/meta.json',
    ]);
    assert.deepEqual(accepted, ['index.html']);
    assert.equal(ignored.length, 4);
    assert.ok(
      ignored.every((i) => i.reason === 'IGNORED_DIRECTORY'),
      '噪声目录应标记为 IGNORED_DIRECTORY',
    );
  });

  it('隐藏文件与系统垃圾文件被忽略', () => {
    const { accepted, ignored } = filterEntries(['index.html', '.DS_Store', 'Thumbs.db', 'a/.env']);
    assert.deepEqual(accepted, ['index.html']);
    assert.equal(ignored.length, 3);
  });

  it('用户上传的 .kernel/ 无法覆盖平台元数据（关键：防止伪造 meta.json）', () => {
    const { accepted } = filterEntries(['.kernel/meta.json', 'a/.kernel/meta.json']);
    assert.deepEqual(accepted, [], '任何层级的 .kernel/ 都不得落盘');
  });

  it('assertAllowedExt 对白名单外扩展名抛 UNSUPPORTED_FILE_TYPE', () => {
    assert.throws(
      () => assertAllowedExt('payload.exe'),
      (error: { code?: string }) => error.code === ERROR_CODE.UNSUPPORTED_FILE_TYPE,
    );
    assert.doesNotThrow(() => assertAllowedExt('index.html'));
  });
});

describe('zip · prescan 正常包', () => {
  it('正常多文件 zip → 通过，条目、体积、压缩比正确', async () => {
    const zipPath = await putZip('normal.zip', buildNormalZip());
    const scan = await prescan(zipPath);

    assert.deepEqual(
      [...scan.acceptedPaths].sort(),
      ['assets/app.js', 'assets/dot.png', 'assets/style.css', 'index.html'],
      '目录条目不应计入，文件条目应全部接受',
    );
    assert.equal(scan.entryCount, 4);
    assert.ok(scan.totalUncompressed > 0);
    assert.ok(scan.ratio <= MAX_ZIP_RATIO);
    assert.equal(scan.ignored.length, 0);
  });

  it('正常包解压后文件内容与原始一致', async () => {
    const zipPath = await putZip('normal2.zip', buildNormalZip());
    const dest = path.join(WORK_DIR, 'extract-ok');
    const scan = await prescan(zipPath);
    const result = await extractSafely(zipPath, dest, scan);

    assert.equal(result.fileCount, 4);
    assert.equal(await fs.readFile(path.join(dest, 'index.html'), 'utf8'), DEMO_HTML);
    assert.equal(
      await fs.readFile(path.join(dest, 'assets', 'style.css'), 'utf8'),
      'body{background:#0E1014;color:#fff;font-family:system-ui}',
    );
    assert.equal(await countFiles(dest), 4, '不应多写或少写文件');
  });

  it('含白名单外条目的包仍能发布，越线条目进 ignored 清单', async () => {
    const zipPath = await putZip('mixed.zip', buildZip([
      { name: 'index.html', data: DEMO_HTML },
      { name: 'setup.exe', data: 'MZ\x90\x00fake-pe-binary' },
      { name: '__MACOSX/._index.html', data: 'junk' },
      { name: '.DS_Store', data: 'junk' },
    ]));

    const scan = await prescan(zipPath);
    assert.deepEqual(scan.acceptedPaths, ['index.html']);
    assert.equal(scan.ignored.length, 3, '三个越线条目都应被透明告知');

    const dest = path.join(WORK_DIR, 'extract-mixed');
    await extractSafely(zipPath, dest, scan);
    assert.equal(await countFiles(dest), 1, '被忽略的条目绝不能落盘');
    assert.equal(
      await fs.access(path.join(dest, 'setup.exe')).then(() => true).catch(() => false),
      false,
      '改名的可执行文件不得落盘',
    );
  });
});

describe('zip · 红线拦截（拒绝 + 磁盘零残留）', () => {
  it(`解压比 > ${MAX_ZIP_RATIO}:1 → ZIP_BOMB_SUSPECTED`, async () => {
    // 10MB 的 0 字节，deflate 后仅数 KB，真实压缩比 ~1000:1
    const zipPath = await putZip('bomb-ratio.zip', buildZip([
      { name: 'index.html', data: DEMO_HTML },
      { name: 'payload.txt', data: Buffer.alloc(10 * 1024 * 1024, 0) },
    ]));
    const onDisk = (await fs.stat(zipPath)).size;
    assert.ok(onDisk < 1024 * 1024, `样本本身应很小才构成炸弹，实际 ${onDisk} 字节`);

    const code = await expectRejectedWithNoResidue(zipPath, '压缩比炸弹');
    assert.equal(code, ERROR_CODE.ZIP_BOMB_SUSPECTED);
  });

  it(`条目数 > ${MAX_ZIP_ENTRIES} → ZIP_TOO_MANY_ENTRIES`, async () => {
    const entries = Array.from({ length: MAX_ZIP_ENTRIES + 50 }, (_, i) => ({
      name: `f${i}.txt`,
      data: 'x',
    }));
    entries.unshift({ name: 'index.html', data: DEMO_HTML });
    const zipPath = await putZip('bomb-entries.zip', buildZip(entries));

    const code = await expectRejectedWithNoResidue(zipPath, '条目数炸弹');
    assert.equal(code, ERROR_CODE.ZIP_TOO_MANY_ENTRIES);
  });

  it(`单条目 > ${Math.round(MAX_ZIP_ENTRY_BYTES / 1024 / 1024)}MB → ZIP_ENTRY_TOO_LARGE`, async () => {
    // 真实构造 51MB 内容（deflate 后极小），走中央目录声明的 uncompressedSize
    const zipPath = await putZip('bomb-entry.zip', buildZip([
      { name: 'index.html', data: DEMO_HTML },
      { name: 'huge.txt', data: Buffer.alloc(MAX_ZIP_ENTRY_BYTES + 1024, 0x41) },
    ]));

    const code = await expectRejectedWithNoResidue(zipPath, '单条目超限');
    assert.equal(code, ERROR_CODE.ZIP_ENTRY_TOO_LARGE);
  });

  it('撒谎的中央目录（声明 uncompressedSize 巨大）同样被拦', async () => {
    const zipPath = await putZip('bomb-liar.zip', buildZip([
      { name: 'index.html', data: DEMO_HTML },
      { name: 'liar.txt', data: 'tiny', fakeUncompressedSize: MAX_ZIP_ENTRY_BYTES + 1 },
    ]));
    const code = await expectRejectedWithNoResidue(zipPath, '声明体积撒谎');
    assert.equal(code, ERROR_CODE.ZIP_ENTRY_TOO_LARGE);
  });

  it('路径穿越条目 `../../evil.html` → 被拒绝，磁盘零残留', async () => {
    const zipPath = await putZip('slip.zip', buildZip([
      { name: 'index.html', data: DEMO_HTML },
      { name: '../../evil.html', data: '<script>alert(1)</script>' },
    ]));

    const code = await expectRejectedWithNoResidue(zipPath, 'zip-slip');
    assert.ok(
      code === ERROR_CODE.PATH_TRAVERSAL_DETECTED || code === ERROR_CODE.ZIP_INVALID,
      `穿越样本应被拒，实际 code=${code}`,
    );

    // 关键：不得在存储根之外写出任何文件
    const escaped = path.resolve(WORK_DIR, '..', '..', 'evil.html');
    assert.equal(
      await fs.access(escaped).then(() => true).catch(() => false),
      false,
      `zip-slip 逃逸成功，宿主机被写入 ${escaped}`,
    );
  });

  it('绝对路径条目 `/etc/passwd` → 被拒绝', async () => {
    const zipPath = await putZip('slip-abs.zip', buildZip([
      { name: 'index.html', data: DEMO_HTML },
      { name: '/etc/passwd', data: 'root:x:0:0' },
    ]));
    const code = await expectRejectedWithNoResidue(zipPath, '绝对路径条目');
    assert.ok(
      code === ERROR_CODE.PATH_TRAVERSAL_DETECTED || code === ERROR_CODE.ZIP_INVALID,
      `实际 code=${code}`,
    );
  });

  it('符号链接条目被识别并忽略（不跟随到宿主机文件）', async () => {
    const zipPath = await putZip('symlink.zip', buildZip([
      { name: 'index.html', data: DEMO_HTML },
      { name: 'link.html', data: '/etc/passwd', unixMode: 0o120777, store: true },
    ]));

    const scan = await prescan(zipPath);
    assert.deepEqual(scan.acceptedPaths, ['index.html'], '符号链接不得进入落盘清单');
    assert.ok(
      scan.ignored.some((i) => i.reason === 'SYMLINK'),
      `应记录 SYMLINK 忽略原因，实际：${JSON.stringify(scan.ignored)}`,
    );

    const dest = path.join(WORK_DIR, 'extract-symlink');
    await extractSafely(zipPath, dest, scan);
    assert.equal(await countFiles(dest), 1);
    assert.equal(
      await fs.access(path.join(dest, 'link.html')).then(() => true).catch(() => false),
      false,
      '符号链接条目不得落盘',
    );
  });

  it('损坏的 ZIP → ZIP_INVALID', async () => {
    const zipPath = await putZip('broken.zip', Buffer.from('PK\x03\x04 not really a zip at all'));
    await assert.rejects(
      () => prescan(zipPath),
      (error: { code?: string }) => error.code === ERROR_CODE.ZIP_INVALID,
    );
  });

  it('全部条目都被过滤掉的 ZIP → ZIP_INVALID（没有可发布内容）', async () => {
    const zipPath = await putZip('all-ignored.zip', buildZip([
      { name: 'a.exe', data: 'MZ' },
      { name: 'b.sh', data: '#!/bin/sh' },
    ]));
    await assert.rejects(
      () => prescan(zipPath),
      (error: { code?: string }) => error.code === ERROR_CODE.ZIP_INVALID,
    );
  });
});

describe('zip · assertRealType 魔数识别（不信任扩展名）', () => {
  it('改扩展名的 PE 文件伪装成 .zip → UNSUPPORTED_FILE_TYPE', async () => {
    // MZ 头 + DOS stub，file-type 会识别为 application/x-msdownload
    const pe = Buffer.concat([
      Buffer.from('MZ'),
      Buffer.alloc(62, 0),
      Buffer.from('This program cannot be run in DOS mode.'),
    ]);
    const file = path.join(WORK_DIR, 'fake.zip');
    await fs.writeFile(file, pe);

    await assert.rejects(
      () => assertRealType(file, 'fake.zip', 'ZIP'),
      (error: { code?: string }) => error.code === ERROR_CODE.UNSUPPORTED_FILE_TYPE,
      '仅凭扩展名放行 = 任意文件上传漏洞',
    );
  });

  it('真 ZIP 通过魔数校验', async () => {
    const file = await putZip('real.zip', buildNormalZip());
    await assert.doesNotReject(() => assertRealType(file, 'real.zip', 'ZIP'));
  });

  it('单文件模式：扩展名非 html → 拒绝', async () => {
    const file = path.join(WORK_DIR, 'a.txt');
    await fs.writeFile(file, DEMO_HTML);
    await assert.rejects(
      () => assertRealType(file, 'a.txt', 'SINGLE_FILE'),
      (error: { code?: string }) => error.code === ERROR_CODE.UNSUPPORTED_FILE_TYPE,
    );
  });

  it('单文件模式：扩展名是 html 但内容不像 HTML → 拒绝', async () => {
    const file = path.join(WORK_DIR, 'fake.html');
    await fs.writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
    await assert.rejects(
      () => assertRealType(file, 'fake.html', 'SINGLE_FILE'),
      (error: { code?: string }) => error.code === ERROR_CODE.UNSUPPORTED_FILE_TYPE,
    );
  });

  it('单文件模式：真 HTML 通过', async () => {
    const file = path.join(WORK_DIR, 'ok.html');
    await fs.writeFile(file, DEMO_HTML);
    await assert.doesNotReject(() => assertRealType(file, 'ok.html', 'SINGLE_FILE'));
  });
});

describe('zip · detectEntryFile 入口识别', () => {
  it('优先根目录 index.html', () => {
    assert.equal(detectEntryFile(['a/index.html', 'index.html', 'main.html']), 'index.html');
  });

  it('无根 index 时取候选优先级', () => {
    assert.equal(detectEntryFile(['main.html', 'home.html']), 'main.html');
  });

  it('单层包裹目录 dist/index.html', () => {
    assert.equal(detectEntryFile(['dist/index.html', 'dist/a.css']), 'dist/index.html');
  });

  it('全不命中时取层级最浅、路径最短的 html', () => {
    assert.equal(detectEntryFile(['deep/a/b/x.html', 'page.html']), 'page.html');
  });

  it('没有任何 html → 空串（由上层报 ENTRY_FILE_NOT_FOUND）', () => {
    assert.equal(detectEntryFile(['a.css', 'b.js']), '');
  });
});

describe('zip · buildFileTree 文件树', () => {
  it('目录在前、同类按名排序，目录体积为子项之和', () => {
    const tree = buildFileTree([
      { path: 'index.html', size: 100 },
      { path: 'assets/style.css', size: 30 },
      { path: 'assets/img/a.png', size: 70 },
    ]);

    assert.equal(tree.length, 2);
    assert.equal(tree[0].name, 'assets');
    assert.equal(tree[0].dir, true);
    assert.equal(tree[0].size, 100, 'assets 应为 30 + 70');
    assert.equal(tree[1].name, 'index.html');
    assert.equal(tree[1].dir, false);
  });
});

describe('validate · assertPublicHttpUrl 外链 SSRF 防护', () => {
  it('公网 https 地址通过', () => {
    assert.equal(assertPublicHttpUrl('https://example.com/demo').hostname, 'example.com');
  });

  const blocked = [
    'http://localhost:3000/admin',
    'http://127.0.0.1/',
    'http://0.0.0.0/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://svc.internal/',
    'http://printer.local/',
    'http://[::1]/',
  ];

  for (const url of blocked) {
    it(`拒绝内网地址 ${url}`, () => {
      assert.throws(
        () => assertPublicHttpUrl(url),
        (error: { code?: string }) => error.code === ERROR_CODE.INVALID_EXTERNAL_URL,
      );
    });
  }

  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<h1>x', 'not a url']) {
    it(`拒绝非 http(s) 协议 ${url}`, () => {
      assert.throws(
        () => assertPublicHttpUrl(url),
        (error: { code?: string }) => error.code === ERROR_CODE.INVALID_EXTERNAL_URL,
      );
    });
  }
});
