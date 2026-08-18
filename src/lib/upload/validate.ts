/**
 * 上传文件校验：体积、魔数、扩展名白名单、条目过滤。
 *
 * 本模块**不直接触碰 fs**，需要读取文件时通过 `lib/storage.ts` 提供的 API。
 */

import { fileTypeFromBuffer } from 'file-type';

import {
  ALLOWED_EXTENSIONS,
  IGNORED_DIR_SEGMENTS,
  IGNORED_FILE_NAMES,
  MAX_UPLOAD_BYTES,
  UPLOAD_MODE,
  type UploadMode,
} from '../constants';
import { AppError, ERROR_CODE } from '../response';
import { readFileBuffer } from '../storage';
import type { IgnoredEntry } from '../types';

/** 条目过滤结果。 */
export interface FilterResult {
  /** 通过白名单、可以落盘的相对路径 */
  accepted: string[];
  /** 被忽略的条目及原因 */
  ignored: IgnoredEntry[];
}

/**
 * 校验上传体积是否在限额内。
 *
 * @throws AppError FILE_TOO_LARGE / VALIDATION_FAILED
 */
export function checkSize(bytes: number, mode: UploadMode): void {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '文件大小无效，请重新选择文件');
  }
  if (bytes > MAX_UPLOAD_BYTES) {
    const limitMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    throw new AppError(ERROR_CODE.FILE_TOO_LARGE, `文件不能超过 ${limitMb}MB，当前文件过大`);
  }
  if (mode === UPLOAD_MODE.EXTERNAL_URL) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '外链模式无需上传文件');
  }
}

/** 取小写扩展名（不含点）。 */
export function extOf(name: string): string {
  const base = name.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/**
 * 安全调用 `fileTypeFromBuffer`。
 *
 * `file-type` 在遇到「已知魔数前缀但被截断」的畸形字节流时会抛出原始的
 * `Error: End-Of-Stream`（不是 AppError）。对上层而言，识别失败与「识别不出类型」
 * 语义完全等价，因此这里把异常吞掉、统一返回空串，避免冒泡成系统级 500。
 *
 * @param head 文件头部字节。
 * @returns 检测到的 mime，未识别或抛错时返回空串。
 */
async function safeFileType(head: Buffer): Promise<string> {
  try {
    const hit = await fileTypeFromBuffer(head);
    return hit?.mime ?? '';
  } catch {
    // 截断 / 畸形字节流会让 file-type 抛 End-Of-Stream。
    // 对上层而言这与「识别不出类型」等价，不该升级成系统异常。
    return '';
  }
}

/**
 * 检测文件真实类型（读取头部 4KB 做魔数匹配）。
 *
 * @param absPath 文件绝对路径。
 * @returns 检测到的 mime，未识别返回空串。
 */
export async function detectMagic(absPath: string): Promise<string> {
  const buffer = await readFileBuffer(absPath);
  const head = buffer.subarray(0, 4096);
  return safeFileType(head);
}

/** HTML 文件的宽松识别（魔数库不识别纯文本，需自行判定）。 */
function looksLikeHtml(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 1024).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<!-- ') || head.startsWith('<meta');
}

/**
 * 按上传模式断言文件真实类型。
 *
 * - ZIP 模式：魔数必须是 `application/zip`
 * - 单文件模式：必须是 HTML（扩展名 + 内容双重判定）
 *
 * @throws AppError UNSUPPORTED_FILE_TYPE
 */
export async function assertRealType(absPath: string, fileName: string, mode: UploadMode): Promise<void> {
  const buffer = await readFileBuffer(absPath);
  const mime = await safeFileType(buffer.subarray(0, 4096));

  if (mode === UPLOAD_MODE.ZIP) {
    if (mime !== 'application/zip') {
      console.warn(`[upload][magic-reject] file=${fileName} mime=${mime || 'unknown'} expect=application/zip`);
      throw new AppError(ERROR_CODE.UNSUPPORTED_FILE_TYPE, '这不是一个有效的 ZIP 压缩包，请重新选择');
    }
    return;
  }

  const ext = extOf(fileName);
  if (ext !== 'html' && ext !== 'htm') {
    throw new AppError(ERROR_CODE.UNSUPPORTED_FILE_TYPE, '单文件模式只支持 .html 文件');
  }
  if (!looksLikeHtml(buffer)) {
    console.warn(`[upload][magic-reject] file=${fileName} 未识别为 HTML 文档`);
    throw new AppError(ERROR_CODE.UNSUPPORTED_FILE_TYPE, '文件内容不像是有效的 HTML 文档');
  }
}

/**
 * 断言扩展名在白名单内。
 *
 * @throws AppError UNSUPPORTED_FILE_TYPE
 */
export function assertAllowedExt(name: string): void {
  const ext = extOf(name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new AppError(ERROR_CODE.UNSUPPORTED_FILE_TYPE, `不支持的文件类型：.${ext || '(无扩展名)'}`);
  }
}

/** 判定某条相对路径是否落在被忽略的目录/文件名规则内。 */
function ignoredReasonOf(relPath: string): IgnoredEntry['reason'] | null {
  const segments = relPath.split('/');
  const fileName = segments[segments.length - 1] ?? '';

  if (relPath.trim() === '' || fileName === '') return 'EMPTY_PATH';
  if (segments.some((seg) => IGNORED_DIR_SEGMENTS.has(seg.toLowerCase()))) return 'IGNORED_DIRECTORY';
  if (IGNORED_FILE_NAMES.has(fileName.toLowerCase())) return 'IGNORED_FILE';
  if (fileName.startsWith('.')) return 'IGNORED_FILE';
  if (!ALLOWED_EXTENSIONS.has(extOf(fileName))) return 'EXTENSION_NOT_ALLOWED';
  return null;
}

/**
 * 过滤 ZIP 条目：剔除噪声目录、隐藏文件与白名单外的扩展名。
 *
 * 被剔除的条目不会导致整包失败，而是记录原因后在发布结果页透明告知用户。
 *
 * @param names 条目相对路径列表（POSIX 风格）。
 */
export function filterEntries(names: string[]): FilterResult {
  const accepted: string[] = [];
  const ignored: IgnoredEntry[] = [];

  for (const name of names) {
    const reason = ignoredReasonOf(name);
    if (reason) {
      ignored.push({ path: name, reason });
    } else {
      accepted.push(name);
    }
  }

  return { accepted, ignored };
}

/**
 * 校验外链地址：必须是 http(s)，且不得指向内网 / 本机。
 *
 * @throws AppError INVALID_EXTERNAL_URL
 */
export function assertPublicHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError(ERROR_CODE.INVALID_EXTERNAL_URL);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(ERROR_CODE.INVALID_EXTERNAL_URL, '外链必须以 http:// 或 https:// 开头');
  }

  const host = parsed.hostname.toLowerCase();
  const isPrivate =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === '[::1]';

  if (isPrivate) {
    console.warn(`[upload][external-url-reject] host=${host}`);
    throw new AppError(ERROR_CODE.INVALID_EXTERNAL_URL, '不允许指向内网或本机地址');
  }

  return parsed;
}
