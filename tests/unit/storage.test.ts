/**
 * lib/storage.ts 路径安全与文件操作测试。
 *
 * 对齐验收点（docs/P0-架构与任务分解.md T02）：
 *   ✅ `resolveSafePath('abc','../../etc/passwd')` 抛 PATH_TRAVERSAL_DETECTED
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import { ERROR_CODE } from '../../src/lib/response';
import {
  commitToProject,
  coverFilePath,
  dataRoot,
  dirSize,
  ensureDataSkeleton,
  extractedDir,
  listFilesRecursive,
  mergeChunks,
  projectsRoot,
  readMeta,
  removeDir,
  removeProjectDir,
  resolveProjectDir,
  resolveSafePath,
  resolveTmpDir,
  resolveWithin,
  writeChunk,
  writeMeta,
  writeTextFile,
} from '../../src/lib/storage';

/** 断言某个调用抛出指定 code 的 AppError。 */
function assertAppError(fn: () => unknown, code: string, hint: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `${hint}：应当抛错但没有`);
  assert.equal((thrown as { name?: string }).name, 'AppError', `${hint}：应抛 AppError`);
  assert.equal((thrown as { code?: string }).code, code, `${hint}：错误码不符`);
}

describe('storage · resolveSafePath 路径穿越防护', () => {
  const TRAVERSAL = ERROR_CODE.PATH_TRAVERSAL_DETECTED;

  const malicious: Array<[string, string]> = [
    ['../../etc/passwd', '经典上跳（验收点原样用例）'],
    ['..', '单独的父目录'],
    ['../', '带斜杠的父目录'],
    ['a/../../../../evil.html', '深层来回跳出'],
    ['..\\..\\windows\\win.ini', 'Windows 反斜杠上跳'],
    ['a/b/../../../out.txt', '中途跳出'],
    ['./../../x', '前置点号后上跳'],
  ];

  for (const [rel, why] of malicious) {
    it(`拒绝 ${JSON.stringify(rel)}（${why}）`, () => {
      assertAppError(() => resolveSafePath('abc123', rel), TRAVERSAL, why);
    });
  }

  it('拒绝绝对路径（POSIX）', () => {
    // path.resolve 会让绝对路径直接顶替 base，必须被前缀校验拦下；
    // 实现里先剥离前导 `/`，因此这里同时验证「剥离后仍留在 base 内」的行为
    const resolved = resolveSafePath('abc123', '/etc/passwd');
    assert.ok(
      resolved.startsWith(resolveProjectDir('abc123') + path.sep),
      '前导 / 被剥离后必须仍落在作品目录内，绝不能逃逸到文件系统根',
    );
  });

  it('Windows 盘符路径不得逃逸（抛错或被夹在 base 内，二者皆可）', () => {
    // 该不变式与平台无关：Windows 上 path.resolve 会被盘符顶替 → 抛错；
    // POSIX 上盘符只是普通文件名 → 仍落在 base 内。两种结果都不构成逃逸。
    const base = resolveProjectDir('abc123');
    let result: string | null = null;
    let thrown: { code?: string } | null = null;
    try {
      result = resolveSafePath('abc123', 'C:\\Windows\\win.ini');
    } catch (error) {
      thrown = error as { code?: string };
    }
    if (thrown) {
      assert.equal(thrown.code, TRAVERSAL, '若抛错必须是 PATH_TRAVERSAL_DETECTED');
    } else {
      assert.ok(result !== null && result.startsWith(base + path.sep), '未抛错时必须仍夹在作品目录内');
    }
  });

  it('拒绝非法 slug（含分隔符 / 上跳 / 超长）', () => {
    for (const slug of ['../evil', 'a/b', 'a\\b', '..', '', 'x'.repeat(65), 'a.b', 'sl ug']) {
      assertAppError(() => resolveSafePath(slug, 'index.html'), TRAVERSAL, `非法 slug ${JSON.stringify(slug)}`);
    }
  });

  it('合法 slug + 合法相对路径 → 正确拼接在 projects 根下', () => {
    const abs = resolveSafePath('Aur9raFx', 'assets/style.css');
    assert.equal(abs, path.join(projectsRoot(), 'Aur9raFx', 'assets', 'style.css'));
    assert.ok(abs.startsWith(projectsRoot() + path.sep), '必须位于 projects 根下');
  });

  it('归一化 Windows 分隔符与冗余段', () => {
    assert.equal(resolveSafePath('Aur9raFx', 'assets\\img\\a.png'), path.join(projectsRoot(), 'Aur9raFx', 'assets', 'img', 'a.png'));
    assert.equal(resolveSafePath('Aur9raFx', './a/./b.css'), path.join(projectsRoot(), 'Aur9raFx', 'a', 'b.css'));
  });

  it('resolveWithin：目标恰好等于 base 时放行，兄弟目录前缀不放行', () => {
    const base = path.join(dataRoot(), 'projects', 'abc');
    assert.equal(resolveWithin(base, ''), base);
    // `abc-evil` 与 `abc` 共享字符串前缀，必须靠 path.sep 区分
    assertAppError(() => resolveWithin(base, '../abc-evil/x'), ERROR_CODE.PATH_TRAVERSAL_DETECTED, '兄弟目录前缀绕过');
  });

  it('coverFilePath 对非法 slug 同样拒绝', () => {
    assertAppError(() => coverFilePath('../../evil'), ERROR_CODE.PATH_TRAVERSAL_DETECTED, '封面路径');
  });

  it('resolveTmpDir 对非法 uploadId 同样拒绝', () => {
    assertAppError(() => resolveTmpDir('../../evil'), ERROR_CODE.PATH_TRAVERSAL_DETECTED, '临时目录');
  });
});

describe('storage · 删除前的数据根断言', () => {
  it('removeDir 拒绝删除存储根之外的目录', async () => {
    await assert.rejects(
      () => removeDir(path.resolve(dataRoot(), '..', 'src')),
      (error: { name?: string; code?: string }) =>
        error.name === 'AppError' && error.code === ERROR_CODE.PATH_TRAVERSAL_DETECTED,
      '越界删除必须被拦下，否则一次配置错误就能删掉源码目录',
    );
  });

  it('removeDir 允许删除存储根之内的目录', async () => {
    const target = path.join(dataRoot(), 'tmp', 'qa-remove-ok');
    await fs.mkdir(target, { recursive: true });
    await removeDir(target);
    assert.equal(await fs.access(target).then(() => true).catch(() => false), false);
  });
});

describe('storage · 文件读写与统计', () => {
  const SLUG = 'qaStor01';
  const UPLOAD_ID = 'qaUpload000001';

  after(async () => {
    await removeProjectDir(SLUG).catch(() => undefined);
    await removeDir(resolveTmpDir(UPLOAD_ID)).catch(() => undefined);
  });

  it('ensureDataSkeleton 建出 projects / tmp / covers 三个根目录', async () => {
    await ensureDataSkeleton();
    for (const dir of ['projects', 'tmp', 'covers']) {
      const st = await fs.stat(path.join(dataRoot(), dir));
      assert.ok(st.isDirectory(), `${dir} 应为目录`);
    }
  });

  it('listFilesRecursive / dirSize 递归统计正确', async () => {
    const dir = resolveProjectDir(SLUG);
    await writeTextFile(path.join(dir, 'index.html'), '<h1>a</h1>');
    await writeTextFile(path.join(dir, 'assets', 'x.css'), 'body{}');

    const files = await listFilesRecursive(dir);
    assert.deepEqual(
      files.map((f) => f.path),
      ['assets/x.css', 'index.html'],
      '应返回 POSIX 相对路径且按字典序排序',
    );
    assert.equal(await dirSize(dir), '<h1>a</h1>'.length + 'body{}'.length);
  });

  it('writeMeta / readMeta 往返一致，readMeta 对缺失目录返回 null', async () => {
    const meta = {
      slug: SLUG,
      title: 'QA 元数据',
      sourceType: 'ZIP' as const,
      entryFile: 'index.html',
      fileCount: 2,
      sizeBytes: 16,
      uploadedAt: new Date().toISOString(),
      expireAt: new Date().toISOString(),
      ignoredFiles: [],
      kernelVersion: 'p0',
    };
    await writeMeta(SLUG, meta);
    assert.deepEqual(await readMeta(SLUG), meta);
    assert.equal(await readMeta('qaNoSuch'), null);
  });

  it('mergeChunks 按序拼接分片，缺片时抛 STORAGE_ERROR', async () => {
    await writeChunk(UPLOAD_ID, 0, Buffer.from('AAA'));
    await writeChunk(UPLOAD_ID, 2, Buffer.from('CCC'));
    await assert.rejects(
      () => mergeChunks(UPLOAD_ID, 3),
      (error: { code?: string }) => error.code === ERROR_CODE.STORAGE_ERROR,
      '缺失分片必须报错，不能吐出残缺文件',
    );

    await writeChunk(UPLOAD_ID, 0, Buffer.from('AAA'));
    await writeChunk(UPLOAD_ID, 1, Buffer.from('BBB'));
    await writeChunk(UPLOAD_ID, 2, Buffer.from('CCC'));
    const merged = await mergeChunks(UPLOAD_ID, 3);
    assert.equal(await fs.readFile(merged, 'utf8'), 'AAABBBCCC', '分片必须严格按序拼接');
  });

  it('commitToProject 拒绝覆盖已存在的作品目录', async () => {
    const src = extractedDir(UPLOAD_ID);
    await writeTextFile(path.join(src, 'index.html'), '<h1>x</h1>');
    await assert.rejects(
      () => commitToProject(UPLOAD_ID, SLUG),
      (error: { code?: string }) => error.code === ERROR_CODE.STORAGE_ERROR,
      '目标已存在时必须拒绝，防止覆盖他人作品',
    );
  });

  it('removeProjectDir 返回释放字节数且目录消失', async () => {
    const before = await dirSize(resolveProjectDir(SLUG));
    assert.ok(before > 0);
    const freed = await removeProjectDir(SLUG);
    assert.equal(freed, before);
    assert.equal(await fs.access(resolveProjectDir(SLUG)).then(() => true).catch(() => false), false);
    assert.equal(await removeProjectDir(SLUG), 0, '重复删除应幂等返回 0');
  });
});
