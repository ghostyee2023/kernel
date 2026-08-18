/**
 * 存储层 —— **全项目唯一允许 `import 'node:fs'` 的文件**。
 *
 * 铁律（docs/P0-架构与任务分解.md §7.3）：
 *   1. 任何 fs 调用只能出现在本文件，其他模块一律通过这里的导出函数访问磁盘
 *   2. 所有外部路径参数进入 fs 前必须过 `resolveSafePath()`，越界抛 PATH_TRAVERSAL_DETECTED
 *   3. 删除前二次断言目标在 KERNEL_DATA_DIR 内，防止配置错误造成灾难性删除
 *   4. 沙箱路由对 `.kernel/` 与任何以 `.` 开头的目录段一律 403（判定见 sandbox.ts）
 *
 * ⬆️ Vercel 试验部署（docs/P0-Vercel试验部署设计.md §1.2 / §7.1）：
 *   - `isBlobBackend()` = NODE_ENV==='production' 且（BLOB_READ_WRITE_TOKEN || BLOB_TOKEN）存在
 *     → 写操作走 Vercel Blob（src/lib/blob.ts，纯 REST，不 import fs），读操作走公共 URL；
 *   - 其余全部 → 本地磁盘（行为与改造前逐字一致）。
 *   - pathname 约定（与本地目录 1:1）：
 *       projects/{slug}/{relPath}           作品文件
 *       projects/{slug}/.kernel/meta.json   磁盘侧元数据
 *       tmp/{uploadId}/session.json         上传会话元数据
 *       tmp/{uploadId}/chunks/{index}.part  分片（跨实例持久）
 *       tmp/{uploadId}/extracted/{relPath}  解压产物 staging
 *       covers/{slug}.svg                   不落 Blob（covers 路由有「磁盘缺失→即时生成」fallback）
 *   - blob 分支不碰 fs 持久盘：Vercel 上 KERNEL_DATA_DIR=/tmp/kernel-data 仅作单请求临时盘。
 *
 * ⬆️ 换 S3 / OSS 时只需重写本文件，其余模块零改动。
 */

import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import { KERNEL_DATA_DIR, KERNEL_META_DIR, KERNEL_META_FILE } from './constants';
import { AppError, ERROR_CODE } from './response';
import { contentTypeOf } from './sandbox';
import type { ProjectMeta } from './types';
import {
  blobPublicUrl,
  deleteBlob,
  getBlob,
  headBlob,
  listBlob,
  putBlob,
} from './blob';

/* ============================================================================
   0) 双模式判定
   ========================================================================== */

/** 避免每次调用都重复打 warn。 */
let blobWarned = false;

/**
 * 存储后端是否为 Vercel Blob（云模式）。
 *
 * 判定（唯一权威）：`NODE_ENV === 'production'` 且（`BLOB_READ_WRITE_TOKEN` 或 `BLOB_TOKEN`）存在。
 * 生产但未配 token → 仍走本地 fs（打 warn），保证部署不崩；试验版文档明确必须配 Blob。
 */
export function isBlobBackend(): boolean {
  const token = process.env.BLOB_READ_WRITE_TOKEN ?? process.env.BLOB_TOKEN ?? '';
  if (process.env.NODE_ENV === 'production') {
    if (token !== '') return true;
    if (!blobWarned) {
      blobWarned = true;
      console.warn('[storage][blob] NODE_ENV=production 但缺少 BLOB_TOKEN/BLOB_READ_WRITE_TOKEN，回退本地磁盘');
    }
  }
  return false;
}

/** 项目文件读取结果。 */
export interface ProjectFile {
  buffer: Buffer;
  size: number;
  contentType: string;
}

/** 项目文件 stat 结果。 */
export interface ProjectFileStat {
  size: number;
  contentType: string;
}

/* ============================================================================
   1) 路径解析
   ========================================================================== */

/** 存储根目录的绝对路径。 */
export function dataRoot(): string {
  return path.resolve(process.cwd(), KERNEL_DATA_DIR);
}

/** `projects/` 根目录。 */
export function projectsRoot(): string {
  return path.join(dataRoot(), 'projects');
}

/** `tmp/` 根目录。 */
export function tmpRoot(): string {
  return path.join(dataRoot(), 'tmp');
}

/** `covers/` 根目录。 */
export function coversRoot(): string {
  return path.join(dataRoot(), 'covers');
}

/** slug 是否为安全的单段目录名（防止 `../` 或分隔符注入）。 */
function isSafeSegment(segment: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(segment);
}

/**
 * 解析作品目录绝对路径。
 *
 * @throws AppError PATH_TRAVERSAL_DETECTED 当 slug 含非法字符。
 */
export function resolveProjectDir(slug: string): string {
  if (!isSafeSegment(slug)) {
    console.warn(`[storage][unsafe-slug] slug=${JSON.stringify(slug)}`);
    throw new AppError(ERROR_CODE.PATH_TRAVERSAL_DETECTED);
  }
  return path.join(projectsRoot(), slug);
}

/**
 * 解析临时上传目录绝对路径。
 *
 * @throws AppError PATH_TRAVERSAL_DETECTED 当 uploadId 含非法字符。
 */
export function resolveTmpDir(uploadId: string): string {
  if (!isSafeSegment(uploadId)) {
    console.warn(`[storage][unsafe-upload-id] uploadId=${JSON.stringify(uploadId)}`);
    throw new AppError(ERROR_CODE.PATH_TRAVERSAL_DETECTED);
  }
  return path.join(tmpRoot(), uploadId);
}

/**
 * 在给定基目录下安全解析相对路径。
 *
 * @param baseDir 基目录绝对路径。
 * @param relPath 外部输入的相对路径（POSIX 或 Windows 分隔符均可）。
 * @returns 归一化后的绝对路径。
 * @throws AppError PATH_TRAVERSAL_DETECTED 当结果越出 baseDir。
 */
export function resolveWithin(baseDir: string, relPath: string): string {
  const normalizedBase = path.resolve(baseDir);
  const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(normalizedBase, cleaned);

  if (target !== normalizedBase && !target.startsWith(normalizedBase + path.sep)) {
    console.warn(`[storage][path-traversal] base=${normalizedBase} rel=${JSON.stringify(relPath)}`);
    throw new AppError(ERROR_CODE.PATH_TRAVERSAL_DETECTED);
  }
  return target;
}

/**
 * 解析作品目录内的安全绝对路径。
 *
 * @param slug 作品短码。
 * @param relPath 作品内相对路径。
 * @throws AppError PATH_TRAVERSAL_DETECTED 当越界。
 */
export function resolveSafePath(slug: string, relPath: string): string {
  return resolveWithin(resolveProjectDir(slug), relPath);
}

/**
 * 断言目标路径位于存储根目录内。所有删除操作前必须调用。
 *
 * @throws AppError PATH_TRAVERSAL_DETECTED 当越界。
 */
function assertWithinDataRoot(target: string): void {
  const root = dataRoot();
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    console.warn(`[storage][unsafe-delete] target=${resolved} root=${root}`);
    throw new AppError(ERROR_CODE.PATH_TRAVERSAL_DETECTED);
  }
}

/**
 * 归一化作品内相对路径（双后端共用）。
 *
 * 规则：反斜杠归一 → 剥离前导 `/` → 拒绝空路径 / `.` / `..` / 空段；
 * 沙箱面向的调用（allowKernel=false）额外拒绝 `.kernel/` 前缀（双保险）。
 *
 * @throws AppError PATH_TRAVERSAL_DETECTED
 */
function assertProjectRelPath(relPath: string, opts: { allowKernel: boolean }): string {
  const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (cleaned === '') {
    throw new AppError(ERROR_CODE.PATH_TRAVERSAL_DETECTED);
  }
  const segments = cleaned.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new AppError(ERROR_CODE.PATH_TRAVERSAL_DETECTED);
  }
  if (!opts.allowKernel && segments[0] === KERNEL_META_DIR) {
    throw new AppError(ERROR_CODE.PATH_TRAVERSAL_DETECTED);
  }
  return cleaned;
}

/* ============================================================================
   2) 基础文件操作
   ========================================================================== */

/** 递归创建目录（已存在则忽略）。 */
export async function ensureDir(absDir: string): Promise<void> {
  await fs.mkdir(absDir, { recursive: true });
}

/** 初始化存储骨架目录（本地与 blob 临时盘共用）。 */
export async function ensureDataSkeleton(): Promise<void> {
  await ensureDir(projectsRoot());
  await ensureDir(tmpRoot());
  await ensureDir(coversRoot());
}

/** 路径是否存在。 */
export async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

/** 文件/目录信息，不存在时返回 null。 */
export async function statPath(
  absPath: string,
): Promise<{ size: number; mtimeMs: number; isFile: boolean; isDirectory: boolean } | null> {
  try {
    const st = await fs.stat(absPath);
    return { size: st.size, mtimeMs: st.mtimeMs, isFile: st.isFile(), isDirectory: st.isDirectory() };
  } catch {
    return null;
  }
}

/** 读取整个文件为 Buffer。 */
export async function readFileBuffer(absPath: string): Promise<Buffer> {
  return fs.readFile(absPath);
}

/** 读取文本文件（UTF-8）。 */
export async function readTextFile(absPath: string): Promise<string> {
  return fs.readFile(absPath, 'utf8');
}

/** 写入文本文件（自动建父目录）。 */
export async function writeTextFile(absPath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(absPath));
  await fs.writeFile(absPath, content, 'utf8');
}

/** 写入二进制文件（自动建父目录）。 */
export async function writeBinaryFile(absPath: string, data: Buffer | Uint8Array): Promise<void> {
  await ensureDir(path.dirname(absPath));
  await fs.writeFile(absPath, data);
}

/**
 * 把可读流写入目标文件（自动建父目录）。
 * 供 ZIP 解压逐条目落盘使用，避免把整包读进内存。
 */
export async function writeStreamToFile(source: Readable, absPath: string): Promise<void> {
  await ensureDir(path.dirname(absPath));
  await pipeline(source, createWriteStream(absPath));
}

/** 递归删除目录（不存在时静默返回）。删除前断言在存储根内。 */
export async function removeDir(absDir: string): Promise<void> {
  assertWithinDataRoot(absDir);
  await fs.rm(absDir, { recursive: true, force: true });
}

/** 删除单个文件（不存在时静默返回）。 */
export async function removeFile(absPath: string): Promise<void> {
  assertWithinDataRoot(absPath);
  await fs.rm(absPath, { force: true });
}

/* ============================================================================
   3) 目录遍历与用量统计
   ========================================================================== */

/**
 * 递归列出目录下所有文件。
 *
 * @param absDir 目录绝对路径。
 * @returns 文件相对路径（POSIX 风格）与体积。
 */
export async function listFilesRecursive(absDir: string): Promise<Array<{ path: string; size: number }>> {
  const out: Array<{ path: string; size: number }> = [];

  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries: Array<import('node:fs').Dirent>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        const st = await fs.stat(abs);
        out.push({ path: rel, size: st.size });
      }
    }
  };

  await walk(absDir, '');
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** 统计目录总体积（字节）。目录不存在时返回 0。 */
export async function dirSize(absDir: string): Promise<number> {
  const files = await listFilesRecursive(absDir);
  return files.reduce((sum, file) => sum + file.size, 0);
}

/* ============================================================================
   3.5) 项目文件（双后端：本地磁盘 / Blob）
   ========================================================================== */

/** `projects/{slug}/` 的 Blob pathname 前缀。 */
function projectBlobPrefix(slug: string): string {
  resolveProjectDir(slug); // 顺带校验 slug 合法性
  return `projects/${slug}/`;
}

/** 是否存在指定 Blob 前缀下的对象。 */
async function blobPrefixExists(prefix: string): Promise<boolean> {
  const result = await listBlob(prefix, { mode: 'flat', limit: 1 });
  return result.blobs.length > 0;
}

/**
 * 读取项目文件（沙箱直出专用）。
 *
 * 内部做 relPath 归一化 + 拒绝 `.kernel/` 与穿越（双保险，与沙箱路由一致）。
 *
 * @returns 文件内容；不存在返回 null。
 */
export async function readProjectFile(slug: string, relPath: string): Promise<ProjectFile | null> {
  const safe = assertProjectRelPath(relPath, { allowKernel: false });
  if (isBlobBackend()) {
    try {
      const buffer = await getBlob(`projects/${slug}/${safe}`);
      return { buffer, size: buffer.byteLength, contentType: contentTypeOf(safe) };
    } catch {
      return null;
    }
  }
  const abs = resolveSafePath(slug, safe);
  const info = await statPath(abs);
  if (!info || !info.isFile) return null;
  const buffer = await readFileBuffer(abs);
  return { buffer, size: buffer.byteLength, contentType: contentTypeOf(safe) };
}

/**
 * 探测项目文件（沙箱 HEAD 专用）。
 *
 * @returns 文件信息；不存在返回 null。
 */
export async function statProjectFile(slug: string, relPath: string): Promise<ProjectFileStat | null> {
  const safe = assertProjectRelPath(relPath, { allowKernel: false });
  if (isBlobBackend()) {
    try {
      const info = await headBlob(`projects/${slug}/${safe}`);
      return info ? { size: info.size, contentType: info.contentType } : null;
    } catch {
      return null;
    }
  }
  const abs = resolveSafePath(slug, safe);
  const info = await statPath(abs);
  if (!info || !info.isFile) return null;
  return { size: info.size, contentType: contentTypeOf(safe) };
}

/**
 * 写入项目文件（seed / publish 落盘）。
 *
 * @param contentType 缺省按扩展名推导。
 */
export async function writeProjectFile(
  slug: string,
  relPath: string,
  data: Buffer | Uint8Array,
  contentType?: string,
): Promise<void> {
  const safe = assertProjectRelPath(relPath, { allowKernel: false });
  if (isBlobBackend()) {
    await putBlob(`projects/${slug}/${safe}`, Buffer.from(data), {
      contentType: contentType ?? contentTypeOf(safe),
      allowOverwrite: true,
    });
    return;
  }
  await writeBinaryFile(resolveSafePath(slug, safe), data);
}

/**
 * 列出项目全部文件（含 `.kernel/meta.json`，与 Blob LIST prefix 语义 1:1）。
 *
 * @returns 相对路径（POSIX）与体积。
 */
export async function listProjectFiles(slug: string): Promise<Array<{ path: string; size: number }>> {
  resolveProjectDir(slug); // 校验 slug 合法性
  if (isBlobBackend()) {
    const result = await listBlob(projectBlobPrefix(slug), { mode: 'flat' });
    return result.blobs
      .map((b) => ({
        path: b.pathname.slice(projectBlobPrefix(slug).length),
        size: b.size,
      }))
      .filter((f) => f.path !== '')
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  return listFilesRecursive(resolveProjectDir(slug));
}

/** 项目目录总体积（字节）；目录不存在时返回 0。 */
export async function projectDirSize(slug: string): Promise<number> {
  const files = await listProjectFiles(slug);
  return files.reduce((sum, file) => sum + file.size, 0);
}

/** 列出 `projects/` 下的全部 slug。 */
export async function listProjectSlugs(): Promise<string[]> {
  if (isBlobBackend()) {
    const result = await listBlob('projects/', { mode: 'folded' });
    return result.blobs
      .map((b) => b.pathname.slice('projects/'.length).replace(/\/+$/, ''))
      .filter((slug) => slug !== '');
  }
  try {
    const entries = await fs.readdir(projectsRoot(), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** 列出 `tmp/` 下的上传会话目录及其最后修改时间。 */
export async function listTmpDirs(): Promise<Array<{ uploadId: string; mtimeMs: number }>> {
  if (isBlobBackend()) {
    const result = await listBlob('tmp/', { mode: 'folded' });
    const out: Array<{ uploadId: string; mtimeMs: number }> = [];
    for (const entry of result.blobs) {
      const uploadId = entry.pathname.slice('tmp/'.length).replace(/\/+$/, '');
      if (uploadId === '') continue;
      const mtime = Date.parse(entry.uploadedAt);
      out.push({ uploadId, mtimeMs: Number.isNaN(mtime) ? Date.now() : mtime });
    }
    return out;
  }

  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(tmpRoot(), { withFileTypes: true });
  } catch {
    return [];
  }

  const out: Array<{ uploadId: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const st = await statPath(path.join(tmpRoot(), entry.name));
    if (st) out.push({ uploadId: entry.name, mtimeMs: st.mtimeMs });
  }
  return out;
}

/* ============================================================================
   4) 上传会话目录
   ========================================================================== */

/** `tmp/{uploadId}/session.json` 绝对路径。 */
export function sessionFilePath(uploadId: string): string {
  return path.join(resolveTmpDir(uploadId), 'session.json');
}

/** `tmp/{uploadId}/chunks/` 绝对路径。 */
export function chunksDir(uploadId: string): string {
  return path.join(resolveTmpDir(uploadId), 'chunks');
}

/** `tmp/{uploadId}/chunks/{index}.part` 绝对路径。 */
export function chunkFilePath(uploadId: string, index: number): string {
  return path.join(chunksDir(uploadId), `${index}.part`);
}

/** `tmp/{uploadId}/merged.bin` 绝对路径。 */
export function mergedFilePath(uploadId: string): string {
  return path.join(resolveTmpDir(uploadId), 'merged.bin');
}

/** `tmp/{uploadId}/extracted/` 绝对路径。 */
export function extractedDir(uploadId: string): string {
  return path.join(resolveTmpDir(uploadId), 'extracted');
}

/** 会话元数据后端感知写入（local=磁盘 JSON；blob=Blob tmp/{id}/session.json）。 */
export async function writeSession(uploadId: string, content: string): Promise<void> {
  resolveTmpDir(uploadId); // 校验 uploadId
  if (isBlobBackend()) {
    await putBlob(`tmp/${uploadId}/session.json`, Buffer.from(content, 'utf8'), {
      contentType: 'application/json; charset=utf-8',
      allowOverwrite: true,
    });
    return;
  }
  await writeTextFile(sessionFilePath(uploadId), content);
}

/** 会话元数据后端感知读取；缺失/损坏返回 null。 */
export async function readSession(uploadId: string): Promise<string | null> {
  resolveTmpDir(uploadId); // 校验 uploadId
  if (isBlobBackend()) {
    try {
      const buffer = await getBlob(`tmp/${uploadId}/session.json`);
      return buffer.toString('utf8');
    } catch {
      return null;
    }
  }
  const file = sessionFilePath(uploadId);
  if (!(await pathExists(file))) return null;
  return readTextFile(file);
}

/** 写入一个分片。 */
export async function writeChunk(uploadId: string, index: number, data: Buffer): Promise<void> {
  if (isBlobBackend()) {
    await putBlob(`tmp/${uploadId}/chunks/${index}.part`, data, {
      contentType: 'application/octet-stream',
      allowOverwrite: true,
    });
    return;
  }
  await ensureDir(chunksDir(uploadId));
  await fs.writeFile(chunkFilePath(uploadId, index), data);
}

/**
 * 按序合并全部分片为 `merged.bin`，成功后删除 `chunks/`（blob 分支删 Blob 分片）。
 *
 * @param uploadId 上传会话 id。
 * @param totalChunks 分片总数。
 * @returns merged.bin 的绝对路径（本地临时盘；blob 模式为 /tmp 下路径，仅本请求内有效）。
 * @throws AppError STORAGE_ERROR 当存在缺失分片。
 */
export async function mergeChunks(uploadId: string, totalChunks: number): Promise<string> {
  const target = mergedFilePath(uploadId);
  await ensureDir(path.dirname(target));

  if (isBlobBackend()) {
    // blob 分支：分片只在 Blob，逐个下载拼到本地临时盘，随后删除 Blob 分片
    const handle = await fs.open(target, 'w');
    const urls: string[] = [];
    try {
      for (let index = 0; index < totalChunks; index += 1) {
        let buffer: Buffer;
        try {
          buffer = await getBlob(`tmp/${uploadId}/chunks/${index}.part`);
        } catch {
          throw new AppError(ERROR_CODE.STORAGE_ERROR, `分片 ${index + 1}/${totalChunks} 缺失，请重新上传`);
        }
        await handle.write(buffer);
        urls.push(blobPublicUrl(`tmp/${uploadId}/chunks/${index}.part`));
      }
    } finally {
      await handle.close();
    }
    await deleteBlob(urls).catch(() => undefined);
    return target;
  }

  const handle = await fs.open(target, 'w');
  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const chunkPath = chunkFilePath(uploadId, index);
      if (!(await pathExists(chunkPath))) {
        throw new AppError(ERROR_CODE.STORAGE_ERROR, `分片 ${index + 1}/${totalChunks} 缺失，请重新上传`);
      }
      const buffer = await fs.readFile(chunkPath);
      await handle.write(buffer);
    }
  } finally {
    await handle.close();
  }

  await fs.rm(chunksDir(uploadId), { recursive: true, force: true });
  return target;
}

/** 删除整个上传会话目录（blob 分支删 Blob tmp/{id}/** 与本地临时盘）。 */
export async function removeTmpDir(uploadId: string): Promise<void> {
  if (isBlobBackend()) {
    const result = await listBlob(`tmp/${uploadId}/`, { mode: 'flat' });
    if (result.blobs.length > 0) {
      await deleteBlob(result.blobs.map((b) => b.url)).catch(() => undefined);
    }
  }
  await removeDir(resolveTmpDir(uploadId));
}

/* ============================================================================
   4.5) 解压产物 staging（blob 分支专用）
   ========================================================================== */

/**
 * 把本地临时盘 `tmp/{uploadId}/extracted/**` 上传到 Blob staging。
 *
 * 仅 blob 后端有动作；local 后端 extracted 已在磁盘，直接由 commitToProject 原子搬移，no-op。
 *
 * @throws AppError STORAGE_ERROR 当 staging 为空。
 */
export async function stageExtracted(uploadId: string): Promise<void> {
  if (!isBlobBackend()) return;
  const dest = extractedDir(uploadId);
  const files = await listFilesRecursive(dest);
  if (files.length === 0) {
    throw new AppError(ERROR_CODE.STORAGE_ERROR, '解压产物为空，无法继续');
  }
  for (const file of files) {
    const buffer = await fs.readFile(path.join(dest, file.path));
    await putBlob(`tmp/${uploadId}/extracted/${file.path}`, buffer, {
      contentType: contentTypeOf(file.path),
      allowOverwrite: true,
    });
  }
  console.log(`[storage][stage-extracted] uploadId=${uploadId} files=${files.length}`);
}

/* ============================================================================
   5) 提交与销毁作品目录
   ========================================================================== */

/**
 * 把 `tmp/{uploadId}/extracted/` 原子迁移为 `projects/{slug}/`。
 *
 * 本地：优先 `rename`（同分区原子）；跨分区（EXDEV）时降级为递归复制 + 删除。
 * blob：LIST staging → 逐个下载 → PUT 到 `projects/{slug}/**` → 删 staging Blob。
 *
 * @throws AppError STORAGE_ERROR 当目标目录已存在或源缺失。
 */
export async function commitToProject(uploadId: string, slug: string): Promise<void> {
  resolveProjectDir(slug); // 校验 slug 合法性

  if (isBlobBackend()) {
    const stagingPrefix = `tmp/${uploadId}/extracted/`;
    const staged = await listBlob(stagingPrefix, { mode: 'flat' });
    if (staged.blobs.length === 0) {
      throw new AppError(ERROR_CODE.STORAGE_ERROR, '上传内容已失效，请重新上传');
    }
    if (await blobPrefixExists(`projects/${slug}/`)) {
      throw new AppError(ERROR_CODE.STORAGE_ERROR, '目标目录已存在，请重试');
    }
    const targetPrefix = `projects/${slug}/`;
    const deleteUrls: string[] = [];
    for (const blob of staged.blobs) {
      const relPath = blob.pathname.slice(stagingPrefix.length);
      if (relPath === '') continue;
      const buffer = await getBlob(blob.pathname);
      await putBlob(`${targetPrefix}${relPath}`, buffer, {
        contentType: contentTypeOf(relPath),
        allowOverwrite: true,
      });
      deleteUrls.push(blob.url);
    }
    await deleteBlob(deleteUrls).catch(() => undefined);
    console.log(`[storage][commit] slug=${slug} blob staged=${staged.blobs.length}`);
    return;
  }

  const source = extractedDir(uploadId);
  const target = resolveProjectDir(slug);

  if (!(await pathExists(source))) {
    throw new AppError(ERROR_CODE.STORAGE_ERROR, '上传内容已失效，请重新上传');
  }
  if (await pathExists(target)) {
    throw new AppError(ERROR_CODE.STORAGE_ERROR, '目标目录已存在，请重试');
  }

  await ensureDir(path.dirname(target));
  try {
    await fs.rename(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV') throw error;
    console.warn(`[storage][commit] rename 跨分区，降级为复制 slug=${slug}`);
    await fs.cp(source, target, { recursive: true });
    await fs.rm(source, { recursive: true, force: true });
  }

  console.log(`[storage][commit] slug=${slug} dir=${target}`);
}

/**
 * 把任意本地目录复制/上传为作品目录。**仅供 `prisma/seed-data.ts` 使用**——
 * 正常发布链路一律走 `commitToProject()`，不允许绕过上传安全流水线。
 *
 * @param sourceAbsDir 素材目录绝对路径（位于仓库内的 `prisma/fixtures/*`）。
 * @param slug 目标作品短码。
 * @param overwrite 目标已存在时是否先清空，默认 true（便于重复 seed）。
 */
export async function seedProjectFromDir(sourceAbsDir: string, slug: string, overwrite = true): Promise<void> {
  resolveProjectDir(slug); // 校验 slug 合法性

  if (isBlobBackend()) {
    const exists = await blobPrefixExists(`projects/${slug}/`);
    if (exists && !overwrite) return;
    if (exists) {
      await removeProjectDir(slug);
    }
    const files = await listFilesRecursive(sourceAbsDir);
    for (const file of files) {
      const buffer = await fs.readFile(path.join(sourceAbsDir, file.path));
      await putBlob(`projects/${slug}/${file.path}`, buffer, {
        contentType: contentTypeOf(file.path),
        allowOverwrite: true,
      });
    }
    console.log(`[storage][seed] slug=${slug} from=${sourceAbsDir} blobs=${files.length}`);
    return;
  }

  const target = resolveProjectDir(slug);
  if (await pathExists(target)) {
    if (!overwrite) return;
    await removeDir(target);
  }
  await ensureDir(path.dirname(target));
  await fs.cp(sourceAbsDir, target, { recursive: true });
  console.log(`[storage][seed] slug=${slug} from=${sourceAbsDir}`);
}

/**
 * 物理删除作品目录。
 *
 * @returns 释放的字节数（删除前统计）。
 */
export async function removeProjectDir(slug: string): Promise<number> {
  if (isBlobBackend()) {
    const result = await listBlob(projectBlobPrefix(slug), { mode: 'flat' });
    if (result.blobs.length === 0) return 0;
    const freed = result.blobs.reduce((sum, b) => sum + b.size, 0);
    await deleteBlob(result.blobs.map((b) => b.url)).catch(() => undefined);
    console.log(`[storage][purge] slug=${slug} freedBytes=${freed}`);
    return freed;
  }

  const dir = resolveProjectDir(slug);
  if (!(await pathExists(dir))) return 0;
  const freed = await dirSize(dir);
  await removeDir(dir);
  console.log(`[storage][purge] slug=${slug} freedBytes=${freed}`);
  return freed;
}

/* ============================================================================
   6) 磁盘侧元数据 `.kernel/meta.json`
   ========================================================================== */

/** 元数据文件绝对路径。 */
function metaFilePath(slug: string): string {
  return path.join(resolveProjectDir(slug), KERNEL_META_DIR, KERNEL_META_FILE);
}

/** 写入作品磁盘元数据（双后端：local=磁盘；blob=projects/{slug}/.kernel/meta.json）。 */
export async function writeMeta(slug: string, meta: ProjectMeta): Promise<void> {
  const content = JSON.stringify(meta, null, 2);
  if (isBlobBackend()) {
    await putBlob(`projects/${slug}/.kernel/meta.json`, Buffer.from(content, 'utf8'), {
      contentType: 'application/json; charset=utf-8',
      allowOverwrite: true,
    });
    return;
  }
  await writeTextFile(metaFilePath(slug), content);
}

/** 读取作品磁盘元数据，缺失或损坏时返回 null。 */
export async function readMeta(slug: string): Promise<ProjectMeta | null> {
  try {
    if (isBlobBackend()) {
      const buffer = await getBlob(`projects/${slug}/.kernel/meta.json`);
      return JSON.parse(buffer.toString('utf8')) as ProjectMeta;
    }
    const raw = await readTextFile(metaFilePath(slug));
    return JSON.parse(raw) as ProjectMeta;
  } catch {
    return null;
  }
}

/* ============================================================================
   7) 封面占位（不落 Blob：covers 路由已有「磁盘缺失 → 即时生成」fallback）
   ========================================================================== */

/** 封面文件绝对路径。 */
export function coverFilePath(slug: string): string {
  if (!isSafeSegment(slug)) throw new AppError(ERROR_CODE.PATH_TRAVERSAL_DETECTED);
  return path.join(coversRoot(), `${slug}.svg`);
}

/** 写入 SVG 占位封面。 */
export async function writeCover(slug: string, svg: string): Promise<void> {
  await writeTextFile(coverFilePath(slug), svg);
}
