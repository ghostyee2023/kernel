/**
 * ZIP 安全流水线：中央目录预扫描 → 安全解压 → 入口文件识别。
 *
 * 安全设计（docs/P0-架构与任务分解.md §1.1 / §7.4）：
 *   1. **先读中央目录再解压**。yauzl 的 `lazyEntries` 模式允许我们在不写入任何
 *      字节的前提下拿到全部条目的 `uncompressedSize`，据此拦截 ZIP 炸弹。
 *   2. 逐条目校验 zip-slip：任何 `..`、绝对路径、盘符、反斜杠穿越一律拒绝整包。
 *   3. 拒绝符号链接条目（Unix 外部属性 0xA000），防止指向宿主机任意文件。
 *   4. 白名单外的扩展名静默忽略并记录原因，不影响整包成功。
 *
 * ⛔ 明确不使用 adm-zip / jszip —— 它们会把整包读入内存，无法在解压前预判体积。
 */

import yauzl from 'yauzl';

import {
  ENTRY_FILE_CANDIDATES,
  MAX_EXTRACTED_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_RATIO,
} from '../constants';
import { AppError, ERROR_CODE } from '../response';
import { ensureDir, resolveWithin, statPath, writeStreamToFile } from '../storage';
import type { ExtractResult, IgnoredEntry, ZipScanResult } from '../types';
import { filterEntries } from './validate';

/** Unix 文件类型掩码与符号链接标记。 */
const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;

/** 打开 ZIP 文件（Promise 包装）。 */
function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false, decodeStrings: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(new AppError(ERROR_CODE.ZIP_INVALID));
        return;
      }
      resolve(zipfile);
    });
  });
}

/** 打开某个条目的读取流（Promise 包装）。 */
function openEntryStream(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(new AppError(ERROR_CODE.ZIP_INVALID, '压缩包内某个文件无法读取，可能已损坏'));
        return;
      }
      resolve(stream);
    });
  });
}

/**
 * 遍历 ZIP 的全部条目。
 *
 * @param zipfile 已打开的 zipfile（必须为 lazyEntries 模式）。
 * @param onEntry 每个条目的处理回调，返回 Promise 以支持串行异步处理。
 */
function eachEntry(zipfile: yauzl.ZipFile, onEntry: (entry: yauzl.Entry) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    let pending = false;

    const fail = (error: unknown): void => {
      zipfile.removeAllListeners();
      reject(error);
    };

    zipfile.on('entry', (entry: yauzl.Entry) => {
      pending = true;
      onEntry(entry)
        .then(() => {
          pending = false;
          zipfile.readEntry();
        })
        .catch(fail);
    });

    zipfile.on('end', () => {
      if (!pending) resolve();
      else resolve();
    });

    zipfile.on('error', () => fail(new AppError(ERROR_CODE.ZIP_INVALID)));

    zipfile.readEntry();
  });
}

/** 条目是否为目录。 */
function isDirectoryEntry(entry: yauzl.Entry): boolean {
  return /\/$/.test(entry.fileName);
}

/** 条目是否为符号链接。 */
function isSymlinkEntry(entry: yauzl.Entry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (unixMode & S_IFMT) === S_IFLNK;
}

/**
 * 归一化 ZIP 条目路径并检测 zip-slip。
 *
 * @param rawName 条目原始名称。
 * @returns 归一化后的 POSIX 相对路径。
 * @throws AppError PATH_TRAVERSAL_DETECTED 当检测到穿越。
 */
export function normalizeEntryName(rawName: string): string {
  const unified = rawName.replace(/\\/g, '/');

  if (unified.includes('\0')) {
    throw new AppError(ERROR_CODE.PATH_TRAVERSAL_DETECTED);
  }
  if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified)) {
    console.warn(`[upload][zip-slip] absolute-path entry=${JSON.stringify(rawName)}`);
    throw new AppError(ERROR_CODE.PATH_TRAVERSAL_DETECTED);
  }

  const segments = unified.split('/').filter((seg) => seg !== '' && seg !== '.');
  if (segments.some((seg) => seg === '..')) {
    console.warn(`[upload][zip-slip] parent-traversal entry=${JSON.stringify(rawName)}`);
    throw new AppError(ERROR_CODE.PATH_TRAVERSAL_DETECTED);
  }

  return segments.join('/');
}

/**
 * 预扫描 ZIP 中央目录。**此阶段不写入任何字节。**
 *
 * @param zipPath 压缩包绝对路径。
 * @returns 扫描结果，含可落盘条目列表与被忽略清单。
 * @throws AppError ZIP_INVALID / ZIP_TOO_MANY_ENTRIES / ZIP_ENTRY_TOO_LARGE /
 *                  ZIP_BOMB_SUSPECTED / PATH_TRAVERSAL_DETECTED
 */
export async function prescan(zipPath: string): Promise<ZipScanResult> {
  const stat = await statPath(zipPath);
  if (!stat || !stat.isFile) {
    throw new AppError(ERROR_CODE.ZIP_INVALID);
  }
  const compressedSize = stat.size;

  const zipfile = await openZip(zipPath);
  const names: string[] = [];
  const sizeByName = new Map<string, number>();
  const ignored: IgnoredEntry[] = [];
  let rawEntryCount = 0;

  try {
    await eachEntry(zipfile, async (entry) => {
      rawEntryCount += 1;
      if (rawEntryCount > MAX_ZIP_ENTRIES) {
        console.warn(`[upload][zip-prescan] entries=${rawEntryCount} limit=${MAX_ZIP_ENTRIES}`);
        throw new AppError(
          ERROR_CODE.ZIP_TOO_MANY_ENTRIES,
          `压缩包内文件数超过 ${MAX_ZIP_ENTRIES} 个上限，请精简后重试`,
        );
      }

      if (isDirectoryEntry(entry)) return;

      if (isSymlinkEntry(entry)) {
        console.warn(`[upload][zip-symlink] entry=${entry.fileName}`);
        ignored.push({ path: entry.fileName, reason: 'SYMLINK' });
        return;
      }

      const normalized = normalizeEntryName(entry.fileName);
      if (normalized === '') {
        ignored.push({ path: entry.fileName, reason: 'EMPTY_PATH' });
        return;
      }

      const uncompressed = Number(entry.uncompressedSize);
      if (uncompressed > MAX_ZIP_ENTRY_BYTES) {
        const limitMb = Math.round(MAX_ZIP_ENTRY_BYTES / (1024 * 1024));
        console.warn(`[upload][zip-entry-too-large] entry=${normalized} size=${uncompressed}`);
        throw new AppError(ERROR_CODE.ZIP_ENTRY_TOO_LARGE, `压缩包内存在超过 ${limitMb}MB 的单个文件，已拒绝`);
      }

      names.push(normalized);
      sizeByName.set(normalized, uncompressed);
    });
  } finally {
    zipfile.close();
  }

  const { accepted, ignored: filteredOut } = filterEntries(names);
  ignored.push(...filteredOut);

  const totalUncompressed = accepted.reduce((sum, name) => sum + (sizeByName.get(name) ?? 0), 0);
  const ratio = compressedSize > 0 ? totalUncompressed / compressedSize : 0;

  console.log(
    `[upload][zip-prescan] entries=${accepted.length} ignored=${ignored.length} ` +
      `uncompressed=${totalUncompressed} compressed=${compressedSize} ratio=${ratio.toFixed(2)}`,
  );

  if (totalUncompressed > MAX_EXTRACTED_BYTES) {
    const limitMb = Math.round(MAX_EXTRACTED_BYTES / (1024 * 1024));
    console.warn(`[upload][zip-bomb] uncompressed=${totalUncompressed} limit=${MAX_EXTRACTED_BYTES}`);
    throw new AppError(ERROR_CODE.ZIP_BOMB_SUSPECTED, `压缩包解压后超过 ${limitMb}MB 上限，已拒绝`);
  }
  if (ratio > MAX_ZIP_RATIO) {
    console.warn(`[upload][zip-bomb] ratio=${ratio.toFixed(2)} limit=${MAX_ZIP_RATIO}`);
    throw new AppError(
      ERROR_CODE.ZIP_BOMB_SUSPECTED,
      `压缩包解压后体积异常（超过 ${MAX_ZIP_RATIO}:1），已拒绝`,
    );
  }
  if (accepted.length === 0) {
    throw new AppError(ERROR_CODE.ZIP_INVALID, '压缩包内没有可发布的文件，请检查内容');
  }

  return {
    entryCount: accepted.length,
    totalUncompressed,
    compressedSize,
    ratio,
    acceptedPaths: accepted,
    ignored,
  };
}

/**
 * 在预扫描通过后安全解压到目标目录。
 *
 * 只解压 `scan.acceptedPaths` 中的条目；每条目路径再过一次 `resolveWithin()`，
 * 形成「预扫描 + 落盘」双重防线。
 *
 * @param zipPath 压缩包绝对路径。
 * @param destDir 目标目录绝对路径。
 * @param scan 预扫描结果。
 */
export async function extractSafely(zipPath: string, destDir: string, scan: ZipScanResult): Promise<ExtractResult> {
  const allowed = new Set(scan.acceptedPaths);
  const files: Array<{ path: string; size: number }> = [];
  let sizeBytes = 0;

  await ensureDir(destDir);
  const zipfile = await openZip(zipPath);

  try {
    await eachEntry(zipfile, async (entry) => {
      if (isDirectoryEntry(entry) || isSymlinkEntry(entry)) return;

      const normalized = normalizeEntryName(entry.fileName);
      if (!allowed.has(normalized)) return;

      // 第二道防线：落盘前再次确认路径不越界
      const target = resolveWithin(destDir, normalized);
      const stream = await openEntryStream(zipfile, entry);
      await writeStreamToFile(stream as unknown as import('node:stream').Readable, target);

      const size = Number(entry.uncompressedSize);
      sizeBytes += size;
      files.push({ path: normalized, size });
    });
  } finally {
    zipfile.close();
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  console.log(`[upload][zip-extract] files=${files.length} bytes=${sizeBytes} dest=${destDir}`);

  return { fileCount: files.length, sizeBytes, files, ignored: scan.ignored };
}

/**
 * 识别入口文件。
 *
 * 优先级：
 *   1. 根目录下的 index.html / index.htm / main.html / home.html
 *   2. 单层包裹目录（如 `dist/index.html`）下的同名候选
 *   3. 任意层级下路径最短的 .html
 *
 * @param fileList 相对路径列表。
 * @returns 入口文件相对路径；找不到返回空串。
 */
export function detectEntryFile(fileList: string[]): string {
  const lower = new Map<string, string>();
  for (const file of fileList) lower.set(file.toLowerCase(), file);

  for (const candidate of ENTRY_FILE_CANDIDATES) {
    const hit = lower.get(candidate);
    if (hit) return hit;
  }

  // 单层包裹目录
  const topDirs = new Set(fileList.map((file) => file.split('/')[0]).filter((seg) => seg.includes('.') === false));
  if (topDirs.size === 1) {
    const [dir] = Array.from(topDirs);
    for (const candidate of ENTRY_FILE_CANDIDATES) {
      const hit = lower.get(`${dir}/${candidate}`.toLowerCase());
      if (hit) return hit;
    }
  }

  const htmlFiles = fileList
    .filter((file) => /\.html?$/i.test(file))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);

  return htmlFiles[0] ?? '';
}

/**
 * 把扁平文件列表构建成树，供上传结果页展示。
 *
 * @param files 相对路径与体积。
 */
export function buildFileTree(files: Array<{ path: string; size: number }>): import('../types').FileNode[] {
  type MutableNode = import('../types').FileNode & { children: import('../types').FileNode[] };
  const root: MutableNode = { path: '', name: '', size: 0, dir: true, children: [] };

  const findOrCreateDir = (parent: MutableNode, name: string, fullPath: string): MutableNode => {
    const existing = parent.children.find((child) => child.dir && child.name === name);
    if (existing) return existing as MutableNode;
    const created: MutableNode = { path: fullPath, name, size: 0, dir: true, children: [] };
    parent.children.push(created);
    return created;
  };

  for (const file of files) {
    const segments = file.path.split('/');
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      cursor = findOrCreateDir(cursor, segments[i], segments.slice(0, i + 1).join('/'));
      cursor.size += file.size;
    }
    cursor.children.push({
      path: file.path,
      name: segments[segments.length - 1],
      size: file.size,
      dir: false,
    });
    root.size += file.size;
  }

  const sortTree = (node: import('../types').FileNode): void => {
    if (!node.children) return;
    node.children.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    node.children.forEach(sortTree);
  };
  sortTree(root);

  return root.children;
}
