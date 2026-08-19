/**
 * 浏览器侧上传客户端。
 *
 * 只依赖 fetch / File API，**不引入任何 node 内置模块**，
 * 保证这个文件能被打进客户端 bundle。
 *
 * 与服务端的三段式契约一一对应：
 *   init（登记）→ chunk × N（传字节）→ complete（校验）
 *
 * 分片大小由服务端在 init 时下发，客户端不写死 —— 服务端调整 CHUNK_SIZE 无需改前端。
 */

import type {
  ApiEnvelope,
  CreateProjectInput,
  CreateProjectResult,
  PatchProjectInput,
  ProjectDTO,
  UploadChunkResult,
  UploadInitResult,
  ValidatedUpload,
} from './types';
import type { UploadMode } from './constants';

/** 上传阶段，用于驱动进度文案。 */
export type UploadPhase = 'init' | 'uploading' | 'validating' | 'done';

/** 进度回调载荷。 */
export interface UploadProgress {
  phase: UploadPhase;
  /** 0–100 */
  percent: number;
  /** 已完成分片数 */
  loadedChunks: number;
  /** 总分片数 */
  totalChunks: number;
  /** 面向用户的一句话说明 */
  message: string;
}

/** 带业务错误码的前端异常，便于按 code 分支处理。 */
export class ApiError extends Error {
  /** 服务端返回的业务错误码。 */
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/**
 * 解析统一响应信封。
 *
 * @throws ApiError 当 `ok === false` 或响应不是合法 JSON。
 */
async function unwrap<T>(response: Response): Promise<T> {
  let body: ApiEnvelope<T>;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError('INTERNAL_ERROR', `服务返回异常（HTTP ${response.status}）`);
  }
  if (!body.ok) {
    throw new ApiError(body.error.code, body.error.message);
  }
  return body.data;
}

/** 根据文件名推断上传模式。 */
export function detectMode(file: File): UploadMode {
  return /\.zip$/i.test(file.name) ? 'ZIP' : 'SINGLE_FILE';
}

/**
 * 完整上传一个文件并拿到安全校验结果。
 *
 * @param file 用户选择的文件。
 * @param mode 上传模式。
 * @param onProgress 进度回调（可选）。
 * @param signal 取消信号（可选）。
 * @returns 服务端的校验结果，可直接用于创建作品。
 */
export async function uploadFile(
  file: File,
  mode: UploadMode,
  onProgress?: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<ValidatedUpload> {
  const report = (phase: UploadPhase, percent: number, loaded: number, total: number, message: string): void => {
    onProgress?.({ phase, percent, loadedChunks: loaded, totalChunks: total, message });
  };

  /* ---------- 1) init ---------- */
  report('init', 0, 0, 1, '正在登记上传任务…');
  const initRes = await fetch('/api/projects/upload-init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, fileSize: file.size, mode }),
    signal,
  });
  const init = await unwrap<UploadInitResult>(initRes);

  /* ---------- 2) chunks ---------- */
  for (let index = 0; index < init.totalChunks; index += 1) {
    if (signal?.aborted) throw new ApiError('ABORTED', '上传已取消');

    const start = index * init.chunkSize;
    const blob = file.slice(start, Math.min(start + init.chunkSize, file.size));

    const form = new FormData();
    form.append('uploadId', init.uploadId);
    form.append('index', String(index));
    form.append('chunk', blob);

    const chunkRes = await fetch('/api/projects/upload-chunk', {
      method: 'POST',
      body: form,
      signal,
    });
    const chunk = await unwrap<UploadChunkResult>(chunkRes);

    // 上传阶段占总进度的 0–85%，剩下 15% 留给安全校验
    const percent = Math.round((chunk.received / chunk.total) * 85);
    report('uploading', percent, chunk.received, chunk.total, `正在上传（${chunk.received}/${chunk.total}）…`);
  }

  /* ---------- 3) complete ---------- */
  report('validating', 88, init.totalChunks, init.totalChunks, '正在做安全检查…');
  const completeRes = await fetch('/api/projects/upload-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId: init.uploadId }),
    signal,
  });
  const validated = await unwrap<ValidatedUpload>(completeRes);

  report('done', 100, init.totalChunks, init.totalChunks, '检查通过');
  return validated;
}

/** 创建作品。 */
export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return unwrap<CreateProjectResult>(response);
}

/** 编辑作品（作者或管理员；PATCH /api/projects/:slug）。 */
export async function patchProject(slug: string, input: PatchProjectInput): Promise<ProjectDTO> {
  const response = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return unwrap<ProjectDTO>(response);
}

/** 拉取作品列表（客户端筛选/翻页时使用）。 */export async function fetchProjects(params: {
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: ProjectDTO[]; total: number }> {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));

  const response = await fetch(`/api/projects?${search.toString()}`);
  const body = (await response.json()) as ApiEnvelope<ProjectDTO[]>;
  if (!body.ok) throw new ApiError(body.error.code, body.error.message);

  return { items: body.data, total: Number(body.meta?.total ?? body.data.length) };
}
