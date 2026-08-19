'use client';

/**
 * ScreenshotUploader —— 作品截图管理（多图 + 裁剪 + 上传）。
 *
 * 交互：
 *   - 「添加截图」→ 选本地图片 → 弹 ImageCropper 裁剪 → 确认后上传
 *     （POST /api/projects/screenshots，multipart）→ 文件名入列；
 *   - 缩略图网格：第一张左上角标「封面」；每张可删除；
 *   - 上限 MAX_SCREENSHOTS 张；上传/删除均为受控（value 为文件名数组）。
 *
 * 裁剪前不占配额：选图 → 裁剪完成才上传入列；取消裁剪不产生任何文件。
 */

import * as React from 'react';

import { ApiError } from '@/lib/upload-client';
import { MAX_SCREENSHOTS } from '@/lib/constants';
import { useToast } from '@/components/ui';

import { ImageCropper } from './ImageCropper';

/** 截图访问路径。 */
export function screenshotUrl(file: string): string {
  return `/api/screenshots/${file}`;
}

/** 组件属性。 */
export interface ScreenshotUploaderProps {
  /** 已上传截图文件名数组（受控）。 */
  value: string[];
  /** 变更回调。 */
  onChange: (next: string[]) => void;
}

/** 上传单张截图（返回文件名）。 */
async function uploadScreenshot(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/projects/screenshots', { method: 'POST', body: form });
  const json = (await response.json().catch(() => null)) as { ok?: boolean; data?: { file?: string }; error?: { code?: string; message?: string } } | null;
  if (!response.ok || !json?.ok || !json.data?.file) {
    throw new ApiError(json?.error?.code ?? 'UPLOAD_FAILED', json?.error?.message ?? '截图上传失败，请重试');
  }
  return json.data.file;
}

/** 渲染截图管理器。 */
export function ScreenshotUploader({ value, onChange }: ScreenshotUploaderProps): React.JSX.Element {
  const { toast } = useToast();
  const [cropperFile, setCropperFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState<boolean>(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const full = value.length >= MAX_SCREENSHOTS;

  /** 校验并进入裁剪（选文件与 Ctrl+V 粘贴共用）。 */
  function startCrop(picked: File): void {
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(picked.type)) {
      toast('仅支持 JPG / PNG / WebP / GIF 图片', 'danger');
      return;
    }
    setCropperFile(picked);
  }

  /** 选择本地图片 → 进入裁剪。 */
  function pickFile(event: React.ChangeEvent<HTMLInputElement>): void {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    startCrop(picked);
  }

  /** Ctrl+V 剪贴板粘贴检测：命中剪贴板图片 → 直接进入裁剪（正在裁剪时替换当前图）。 */
  React.useEffect(() => {
    function onPaste(event: ClipboardEvent): void {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            startCrop(file);
            toast('已检测到剪贴板图片，可直接裁剪', 'success');
            return;
          }
        }
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 裁剪确认 → 上传 → 入列。 */
  async function confirmCrop(blob: Blob): Promise<void> {
    setCropperFile(null);
    setUploading(true);
    try {
      const file = new File([blob], `screenshot-${Date.now()}.webp`, { type: blob.type });
      const name = await uploadScreenshot(file);
      onChange([...value, name]);
      toast('截图已添加', 'success');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '截图上传失败，请重试';
      toast(message, 'danger');
    } finally {
      setUploading(false);
    }
  }

  /** 删除指定截图。 */
  function remove(index: number): void {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="shot-uploader">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={pickFile}
      />

      {value.length > 0 ? (
        <div className="shot-uploader__grid">
          {value.map((file, index) => (
            <div key={file} className="shot-uploader__item">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={screenshotUrl(file)} alt={`作品截图 ${index + 1}`} loading="lazy" />
              {index === 0 ? <span className="shot-uploader__cover">封面</span> : null}
              <button
                type="button"
                className="shot-uploader__del"
                title="删除这张截图"
                aria-label={`删除截图 ${index + 1}`}
                onClick={() => remove(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">还没有截图。上传后第一张会作为作品封面展示。支持 Ctrl+V 直接粘贴剪贴板截图。</p>
      )}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={full || uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? '上传中…' : full ? `最多 ${MAX_SCREENSHOTS} 张` : '+ 添加截图（或 Ctrl+V 粘贴）'}
      </button>

      {cropperFile ? (
        <div className="cropper-modal" role="dialog" aria-modal="true" aria-label="裁剪截图">
          <div className="cropper-modal__panel">
            <ImageCropper file={cropperFile} onCancel={() => setCropperFile(null)} onConfirm={(blob) => void confirmCrop(blob)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
