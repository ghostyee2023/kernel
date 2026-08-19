'use client';

/**
 * 发布向导：三步走完「选文件 → 填信息 → 拿短链」。
 *
 * 状态机刻意集中在这一个组件里 —— 子组件全是受控展示层，
 * 不各自持有上传状态，避免出现「进度条走完了但父组件还不知道」这类不同步。
 *
 *   step 1  选择上传方式 + 文件（或填外链）→ 触发上传 + 安全校验
 *   step 2  展示安全检查结果 + 填写发布信息 → 创建作品
 *   step 3  展示短链 / 二维码
 */

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, useToast } from '@/components/ui';
import { UPLOAD_MODE, type UploadMode } from '@/lib/constants';
import { formatBytes } from '@/lib/format';
import type { CreateProjectResult, ValidatedUpload } from '@/lib/types';
import { ApiError, createProject, uploadFile, type UploadProgress } from '@/lib/upload-client';

import { Dropzone } from './Dropzone';
import { PublishForm, type PublishFormValue } from './PublishForm';
import { PublishSuccess } from './PublishSuccess';
import { SecurityCheckResult } from './SecurityCheckResult';
import { Steps } from './Steps';
import { UploadModeTabs } from './UploadModeTabs';

/** 各模式的 accept 与提示。 */
const ACCEPT: Record<string, { accept: string; hint: string }> = {
  ZIP: { accept: '.zip,application/zip', hint: '压缩包内需包含 index.html，最大 100MB' },
  SINGLE_FILE: { accept: '.html,.htm,text/html', hint: '单个自包含的 HTML 文件，最大 100MB' },
};

/** 渲染发布向导。 */
export function UploadWizard() {
  const { toast } = useToast();
  const router = useRouter();

  const [step, setStep] = useState<number>(1);
  const [mode, setMode] = useState<UploadMode>(UPLOAD_MODE.ZIP);

  const [file, setFile] = useState<File | null>(null);
  const [externalUrl, setExternalUrl] = useState<string>('');

  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [validated, setValidated] = useState<ValidatedUpload | null>(null);
  const [result, setResult] = useState<CreateProjectResult | null>(null);
  /** 发布时表单标题快照，供成功页分享海报使用。 */
  const [publishedTitle, setPublishedTitle] = useState<string>('');

  const [busy, setBusy] = useState<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);

  /** 回到初始状态，用于「再发布一件」。 */
  const reset = useCallback((): void => {
    setStep(1);
    setMode(UPLOAD_MODE.ZIP);
    setFile(null);
    setExternalUrl('');
    setProgress(null);
    setValidated(null);
    setResult(null);
    setBusy(false);
  }, []);

  /**
   * 会话过期统一处理：toast 提示并跳登录，登录后回到发布页。
   *
   * @returns 是否已处理（true 时调用方应直接 return，不再继续错误分支）。
   */
  const handleAuthError = useCallback(
    (error: unknown): boolean => {
      if (error instanceof ApiError && error.code === 'NOT_LOGGED_IN') {
        toast('登录状态已过期，请先登录后发布作品', 'danger');
        router.push('/login?next=/new');
        return true;
      }
      return false;
    },
    [router, toast],
  );

  /** 第一步：上传并校验。 */
  const handleUpload = useCallback(async (): Promise<void> => {
    if (!file) return;

    setBusy(true);
    setProgress(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const checked = await uploadFile(file, mode, setProgress, controller.signal);
      setValidated(checked);
      setStep(2);
      toast('安全检查通过', 'success');
    } catch (error) {
      if (handleAuthError(error)) return;
      const message = error instanceof ApiError ? error.message : '上传失败，请重试';
      toast(message, 'danger');
      setProgress(null);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [file, handleAuthError, mode, toast]);

  /** 第一步（外链分支）：无需上传，直接进入填写。 */
  const handleExternalNext = useCallback((): void => {
    const trimmed = externalUrl.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      toast('请填写以 http(s):// 开头的完整地址', 'danger');
      return;
    }
    setValidated(null);
    setStep(2);
  }, [externalUrl, toast]);

  /** 第二步：创建作品。 */
  const handlePublish = useCallback(
    async (form: PublishFormValue): Promise<void> => {
      setBusy(true);
      try {
        const created = await createProject({
          uploadId: validated?.uploadId,
          externalUrl: mode === UPLOAD_MODE.EXTERNAL_URL ? externalUrl.trim() : undefined,
          title: form.title,
          summary: form.summary || undefined,
          description: form.description || undefined,
          authorAlias: form.authorAlias || undefined,
          visibility: form.visibility,
          ttlDays: form.ttlDays,
          entryFile: form.entryFile || undefined,
          screenshots: form.screenshots.length > 0 ? form.screenshots : undefined,
          tagIds: form.tagIds.length > 0 ? form.tagIds : undefined,
        });
        setResult(created);
        setPublishedTitle(form.title);
        setStep(3);
      } catch (error) {
        if (handleAuthError(error)) return;
        const message = error instanceof ApiError ? error.message : '发布失败，请重试';
        toast(message, 'danger');
      } finally {
        setBusy(false);
      }
    },
    [externalUrl, handleAuthError, mode, toast, validated],
  );

  const isExternal = mode === UPLOAD_MODE.EXTERNAL_URL;
  const acceptConfig = ACCEPT[mode] ?? ACCEPT.ZIP;

  return (
    <div className="wizard">
      <Steps current={step} />

      {/* ---------- 第 1 步 ---------- */}
      {step === 1 ? (
        <section className="wizard__step" aria-label="选择作品文件">
          <UploadModeTabs value={mode} onChange={setMode} disabled={busy} />

          {isExternal ? (
            <div className="field">
              <label htmlFor="wz-url">外链地址</label>
              <input
                id="wz-url"
                className="input"
                type="url"
                inputMode="url"
                placeholder="https://example.com/my-work"
                value={externalUrl}
                onChange={(event) => setExternalUrl(event.target.value)}
              />
              <p className="hint">必须是公网可访问的 http(s) 地址；内网与本机地址会被拒绝。</p>
            </div>
          ) : (
            <Dropzone
              accept={acceptConfig.accept}
              hint={acceptConfig.hint}
              file={file}
              disabled={busy}
              onSelect={(picked) => {
                setFile(picked);
                setProgress(null);
              }}
            />
          )}

          {progress ? (
            <div className="upload-progress" role="status" aria-live="polite">
              <div
                className="progress"
                role="progressbar"
                aria-valuenow={progress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <i style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="upload-progress__text">
                <span>{progress.message}</span>
                <span className="mono">
                  {progress.percent}%{file ? ` · ${formatBytes(file.size)}` : ''}
                </span>
              </p>
            </div>
          ) : null}

          <div className="wizard__actions">
            {isExternal ? (
              <Button onClick={handleExternalNext} disabled={busy || externalUrl.trim() === ''}>
                下一步
              </Button>
            ) : (
              <Button onClick={() => void handleUpload()} disabled={busy || !file}>
                {busy ? '处理中…' : '上传并检查'}
              </Button>
            )}
          </div>
        </section>
      ) : null}

      {/* ---------- 第 2 步 ---------- */}
      {step === 2 ? (
        <section className="wizard__step" aria-label="完善作品信息">
          {validated ? <SecurityCheckResult result={validated} /> : null}

          <PublishForm
            validated={validated}
            externalUrl={isExternal ? externalUrl.trim() : undefined}
            submitting={busy}
            onBack={() => setStep(1)}
            onSubmit={(form) => void handlePublish(form)}
          />
        </section>
      ) : null}

      {/* ---------- 第 3 步 ---------- */}
      {step === 3 && result ? (
        <section className="wizard__step" aria-label="发布成功">
          <PublishSuccess result={result} title={publishedTitle} onPublishAnother={reset} />
        </section>
      ) : null}
    </div>
  );
}
