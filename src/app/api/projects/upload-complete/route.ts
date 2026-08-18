/**
 * POST /api/projects/upload-complete
 *
 * 三段式上传第 3 段：合并分片 → 安全流水线 → 产出可发布的校验结果。
 *
 * 安全流水线（docs/P0-架构与任务分解.md §4.2，顺序不可调换）：
 *   1. 合并分片得到 merged.bin
 *   2. magic number 真实类型识别（不信任扩展名 / Content-Type）
 *   3. ZIP：中央目录预扫描（条目数 / 单条目体积 / 解压比 / 后缀白名单），**未落一个字节**
 *   4. 通过后才解压，逐条目二次做 zip-slip 防护
 *   5. 识别入口文件、生成文件树
 *
 * 本接口只校验、不入库；作品在 `POST /api/projects` 时才真正创建。
 */

import path from 'node:path';

import type { NextRequest } from 'next/server';

import { requireUser } from '@/lib/auth';
import { UPLOAD_MODE } from '@/lib/constants';
import { AppError, ERROR_CODE, ok, toErrorResponse } from '@/lib/response';
import {
  extractedDir,
  isBlobBackend,
  mergedFilePath,
  readFileBuffer,
  removeDir,
  resolveTmpDir,
  stageExtracted,
  writeBinaryFile,
} from '@/lib/storage';
import type { ExtractResult, ValidatedUpload } from '@/lib/types';
import * as session from '@/lib/upload/session';
import { assertAllowedExt, assertRealType } from '@/lib/upload/validate';
import { buildFileTree, detectEntryFile, extractSafely, prescan } from '@/lib/upload/zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 单文件模式统一落盘为该文件名，杜绝奇异文件名带来的路由歧义。 */
const SINGLE_FILE_ENTRY = 'index.html';

/** 请求体。 */
interface CompleteBody {
  uploadId?: unknown;
}

export async function POST(request: NextRequest) {
  let uploadId = '';
  try {
    // 鉴权最先：上传三段式均要求登录（docs/03 §3.1）
    await requireUser();

    let body: CompleteBody;
    try {
      body = (await request.json()) as CompleteBody;
    } catch {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '请求体不是合法 JSON');
    }

    uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : '';
    if (uploadId === '') {
      throw new AppError(ERROR_CODE.VALIDATION_FAILED, '缺少 uploadId');
    }

    const current = await session.load(uploadId);

    // 已经校验过就直接复用，保证接口幂等（用户刷新页面不会重复解压）
    if (current.status === 'VALIDATED' && current.validated) {
      return ok(current.validated);
    }

    /* ---------- 1) 合并 ---------- */
    await session.merge(uploadId);
    const merged = mergedFilePath(uploadId);

    /* ---------- 2) 真实类型识别 ---------- */
    await assertRealType(merged, current.fileName, current.mode);

    const dest = extractedDir(uploadId);
    // 重入保护：残留的上一次解压结果必须先清空
    await removeDir(dest);

    const warnings: string[] = [];
    let result: ExtractResult;
    let entryFile = '';

    if (current.mode === UPLOAD_MODE.ZIP) {
      /* ---------- 3) 预扫描（零落盘） ---------- */
      const scan = await prescan(merged);
      if (scan.acceptedPaths.length === 0) {
        throw new AppError(ERROR_CODE.ZIP_INVALID, '压缩包内没有可发布的文件');
      }

      /* ---------- 4) 安全解压 ---------- */
      result = await extractSafely(merged, dest, scan);

      /* ---------- 5) 入口文件 ---------- */
      entryFile = detectEntryFile(result.files.map((file) => file.path));
      if (entryFile === '') {
        await removeDir(dest);
        throw new AppError(ERROR_CODE.ENTRY_FILE_NOT_FOUND);
      }
      if (path.posix.basename(entryFile).toLowerCase() !== 'index.html') {
        warnings.push(`未找到 index.html，已自动使用 ${entryFile} 作为入口`);
      }
      if (scan.ratio > 20) {
        warnings.push(`压缩比 ${scan.ratio.toFixed(1)}x 偏高，请确认压缩包内容`);
      }
    } else {
      /* ---------- 单文件：直接落为 index.html ---------- */
      assertAllowedExt(current.fileName);
      const buffer = await readFileBuffer(merged);
      await writeBinaryFile(path.join(dest, SINGLE_FILE_ENTRY), buffer);

      entryFile = SINGLE_FILE_ENTRY;
      result = {
        fileCount: 1,
        sizeBytes: buffer.byteLength,
        files: [{ path: SINGLE_FILE_ENTRY, size: buffer.byteLength }],
        ignored: [],
      };
      if (current.fileName.toLowerCase() !== SINGLE_FILE_ENTRY) {
        warnings.push(`已将 ${current.fileName} 重命名为 index.html 作为入口`);
      }
    }

    if (result.ignored.length > 0) {
      warnings.push(`已忽略 ${result.ignored.length} 个不受支持的文件`);
    }

    const validated: ValidatedUpload = {
      uploadId,
      mode: current.mode,
      fileCount: result.fileCount,
      sizeBytes: result.sizeBytes,
      entryFileSuggested: entryFile,
      fileTree: buildFileTree(result.files),
      ignoredFiles: result.ignored,
      warnings,
    };

    await session.attachValidation(uploadId, validated);
    console.log(
      `[upload][complete] uploadId=${uploadId} mode=${current.mode} files=${validated.fileCount} entry=${entryFile}`,
    );

    // 生产（blob）后端：把解压产物上传到 Blob staging，供发布时 commitToProject 使用；
    // local 后端 no-op（extracted 已在磁盘，commit 时原子搬移）。
    await stageExtracted(uploadId);

    // 单请求内临时盘清理（尽力而为；Vercel 冷启动本就重置，local 保留 extracted 供 commit）
    if (isBlobBackend()) {
      await removeDir(resolveTmpDir(uploadId)).catch(() => undefined);
    }

    return ok(validated);
  } catch (error) {
    // 安全校验失败的临时目录没有保留价值，立刻回收
    if (uploadId !== '' && error instanceof AppError && error.code !== ERROR_CODE.UPLOAD_SESSION_NOT_FOUND) {
      await session.discard(uploadId).catch(() => undefined);
    }
    return toErrorResponse(error, 'upload-complete');
  }
}
