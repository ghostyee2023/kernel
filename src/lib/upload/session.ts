/**
 * 上传会话：三段式契约（init → chunk → complete）的状态机。
 *
 * 会话元数据持久化在 `tmp/{uploadId}/session.json`（本地磁盘 / Vercel Blob 双后端，
 * 由 storage 层分发，本文件不感知后端），无需 Redis。
 * 分片大小：本地 5MB；`NODE_ENV=production` 时 3MB（Vercel Function 请求体上限 4.5MB，Q5）。
 * 文件 ≤分片大小时 `totalChunks = 1`，不做单独的小文件直传分支，保证只有一条代码路径。
 * ⬆️ P1 接 S3 分片时对外契约不变。
 */

import { customAlphabet } from 'nanoid';

import {
  BASE58_ALPHABET,
  CHUNK_SIZE,
  CHUNK_SIZE_PRODUCTION,
  isProductionMode,
  UPLOAD_MODE,
  UPLOAD_SESSION_TTL_MS,
  type UploadMode,
} from '../constants';
import { AppError, ERROR_CODE } from '../response';
import {
  chunksDir,
  ensureDir,
  mergeChunks,
  mergedFilePath,
  readSession,
  removeTmpDir,
  resolveTmpDir,
  writeChunk,
  writeSession,
} from '../storage';
import type { UploadSession, ValidatedUpload } from '../types';
import { checkSize } from './validate';

const nanoUploadId = customAlphabet(BASE58_ALPHABET, 16);

/**
 * 初始化上传会话。
 *
 * @param fileName 原始文件名。
 * @param fileSize 文件字节数。
 * @param mode 上传模式。
 * @returns 新建的会话。
 * @throws AppError VALIDATION_FAILED / FILE_TOO_LARGE
 */
export async function init(fileName: string, fileSize: number, mode: UploadMode): Promise<UploadSession> {
  if (typeof fileName !== 'string' || fileName.trim() === '') {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '缺少文件名');
  }
  if (mode !== UPLOAD_MODE.ZIP && mode !== UPLOAD_MODE.SINGLE_FILE) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '不支持的上传模式');
  }
  checkSize(fileSize, mode);

  const uploadId = nanoUploadId();
  const now = new Date();
  // 生产分片 3MB（Vercel 4.5MB 请求体上限）；本地 5MB 不变
  const chunkSize = isProductionMode() ? CHUNK_SIZE_PRODUCTION : CHUNK_SIZE;
  const session: UploadSession = {
    uploadId,
    // 只保留基础名，杜绝路径注入
    fileName: fileName.split(/[\\/]/).pop() ?? 'upload.bin',
    fileSize,
    mode,
    chunkSize,
    totalChunks: Math.max(1, Math.ceil(fileSize / chunkSize)),
    receivedChunks: [],
    status: 'INIT',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + UPLOAD_SESSION_TTL_MS).toISOString(),
  };

  await ensureDir(chunksDir(uploadId));
  await save(session);

  console.log(
    `[upload][init] uploadId=${uploadId} file=${session.fileName} size=${fileSize} chunks=${session.totalChunks} chunkSize=${chunkSize}`,
  );
  return session;
}

/** 持久化会话元数据（storage 层按后端分发：本地磁盘 / Blob）。 */
export async function save(session: UploadSession): Promise<void> {
  await writeSession(session.uploadId, JSON.stringify(session, null, 2));
}

/**
 * 读取会话。
 *
 * @throws AppError UPLOAD_SESSION_NOT_FOUND / UPLOAD_SESSION_EXPIRED
 */
export async function load(uploadId: string): Promise<UploadSession> {
  const raw = await readSession(uploadId);
  if (raw === null) {
    throw new AppError(ERROR_CODE.UPLOAD_SESSION_NOT_FOUND);
  }

  let session: UploadSession;
  try {
    session = JSON.parse(raw) as UploadSession;
  } catch {
    throw new AppError(ERROR_CODE.UPLOAD_SESSION_NOT_FOUND);
  }

  if (new Date(session.expiresAt).getTime() < Date.now()) {
    console.warn(`[upload][session-expired] uploadId=${uploadId}`);
    throw new AppError(ERROR_CODE.UPLOAD_SESSION_EXPIRED);
  }
  return session;
}

/**
 * 写入一个分片。
 *
 * @param uploadId 会话 id。
 * @param index 分片序号（0 起）。
 * @param buffer 分片内容。
 * @returns 更新后的会话。
 * @throws AppError VALIDATION_FAILED
 */
export async function writeChunkAt(uploadId: string, index: number, buffer: Buffer): Promise<UploadSession> {
  const session = await load(uploadId);

  if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '分片序号超出范围');
  }
  if (buffer.byteLength === 0) {
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, '分片内容为空');
  }
  if (buffer.byteLength > session.chunkSize) {
    const sizeMb = Math.round(session.chunkSize / (1024 * 1024));
    throw new AppError(ERROR_CODE.VALIDATION_FAILED, `分片体积超过约定的 ${sizeMb}MB`);
  }

  await writeChunk(uploadId, index, buffer);

  if (!session.receivedChunks.includes(index)) {
    session.receivedChunks.push(index);
    session.receivedChunks.sort((a, b) => a - b);
  }
  session.status = 'UPLOADING';
  await save(session);

  return session;
}

/**
 * 合并全部分片为 `merged.bin`。
 *
 * @returns merged.bin 绝对路径。
 * @throws AppError VALIDATION_FAILED 当仍有分片缺失。
 */
export async function merge(uploadId: string): Promise<string> {
  const session = await load(uploadId);

  if (session.status === 'MERGED' || session.status === 'VALIDATED') {
    return mergedFilePath(uploadId);
  }
  if (session.receivedChunks.length !== session.totalChunks) {
    throw new AppError(
      ERROR_CODE.VALIDATION_FAILED,
      `分片未全部上传（${session.receivedChunks.length}/${session.totalChunks}），请重试`,
    );
  }

  const merged = await mergeChunks(uploadId, session.totalChunks);
  session.status = 'MERGED';
  await save(session);

  console.log(`[upload][merge] uploadId=${uploadId} chunks=${session.totalChunks} path=${merged}`);
  return merged;
}

/** 把校验结果写回会话，供后续 `POST /api/projects` 复用。 */
export async function attachValidation(uploadId: string, validated: ValidatedUpload): Promise<UploadSession> {
  const session = await load(uploadId);
  session.validated = validated;
  session.status = 'VALIDATED';
  await save(session);
  return session;
}

/** 标记会话已提交（目录已迁移到 projects/）。 */
export async function markCommitted(uploadId: string): Promise<void> {
  const raw = await readSession(uploadId);
  if (raw === null) return;
  const session = JSON.parse(raw) as UploadSession;
  session.status = 'COMMITTED';
  await save(session);
}

/** 丢弃会话并删除整个临时目录（storage 层按后端分发）。 */
export async function discard(uploadId: string): Promise<void> {
  await removeTmpDir(uploadId);
  console.log(`[upload][discard] uploadId=${uploadId}`);
}

/** 会话临时目录绝对路径（供上层记录日志）。 */
export function sessionDir(uploadId: string): string {
  return resolveTmpDir(uploadId);
}
