'use client';

/**
 * ScreenshotUploader —— 作品截图管理（多选 + 排队裁剪 + 上传 + 拖拽排序）。
 *
 * 交互：
 *   - 「添加截图」→ 可一次多选本地图片（`multiple`）→ 逐张弹 ImageCropper 裁剪
 *     （确认后上传 POST /api/projects/screenshots；取消则跳过该张）→ 文件名按序入列；
 *   - Ctrl+V 剪贴板粘贴：单张图片直接进入裁剪（正在裁剪时替换当前图）；
 *   - 缩略图网格：第一张左上角标「封面」；**可拖拽调整顺序**（第一张即封面，排序影响封面）；
 *   - 每张可删除；上限 MAX_SCREENSHOTS 张；上传/删除/排序均为受控（value 为文件名数组）。
 *
 * 裁剪前不占配额：选图 → 裁剪完成才上传入列；取消裁剪不产生任何文件。
 */

import * as React from 'react';

import { useToast } from '@/components/ui';
import { ApiError } from '@/lib/upload-client';
import { MAX_SCREENSHOTS } from '@/lib/constants';
import { cn } from '@/lib/cn';

import { ImageCropper } from './ImageCropper';

/** 截图访问路径。 */
export function screenshotUrl(file: string): string {
  return `/api/screenshots/${file}`;
}

/** 组件属性。 */
export interface ScreenshotUploaderProps {
  /** 已上传截图文件名数组（受控；第 0 项即封面）。 */
  value: string[];
  /** 变更回调（增删 / 排序）。 */
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

/** 图片类型白名单（与上传 API 一致）。 */
function isImageType(type: string): boolean {
  return /^image\/(jpeg|png|webp|gif)$/i.test(type);
}

/** 渲染截图管理器。 */
export function ScreenshotUploader({ value, onChange }: ScreenshotUploaderProps): React.JSX.Element {
  const { toast } = useToast();
  /** 当前正在裁剪的图片；null = 空闲。 */
  const [cropperFile, setCropperFile] = React.useState<File | null>(null);
  /** 待裁剪队列长度（多选排队时显示「剩余 N 张」）。 */
  const [queueLen, setQueueLen] = React.useState<number>(0);
  const [uploading, setUploading] = React.useState<boolean>(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  /** 待裁剪队列（ref 避免事件闭包陈旧）。 */
  const pendingRef = React.useRef<File[]>([]);
  /** 拖拽排序：源下标。 */
  const dragIndexRef = React.useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);

  const full = value.length >= MAX_SCREENSHOTS;

  /** 从队列弹出下一张进入裁剪（无则保持空闲）。 */
  function popNext(): void {
    if (pendingRef.current.length === 0) {
      setQueueLen(0);
      return;
    }
    const next = pendingRef.current.shift()!;
    setQueueLen(pendingRef.current.length);
    setCropperFile(next);
  }

  /** 入队并开始裁剪（多选 / 粘贴共用）。 */
  function enqueue(files: File[]): void {
    const valid = files.filter((f) => isImageType(f.type));
    if (valid.length === 0) {
      toast('仅支持 JPG / PNG / WebP / GIF 图片', 'danger');
      return;
    }
    pendingRef.current.push(...valid);
    if (cropperFile === null) {
      // 空闲 → 直接弹第一张
      const first = pendingRef.current.shift()!;
      setQueueLen(pendingRef.current.length);
      setCropperFile(first);
    } else {
      setQueueLen(pendingRef.current.length);
    }
  }

  /** 选择本地图片（支持多选）→ 入队逐张裁剪。 */
  function pickFile(event: React.ChangeEvent<HTMLInputElement>): void {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (picked.length === 0) return;
    enqueue(picked);
  }

  /** Ctrl+V 剪贴板粘贴检测：命中剪贴板图片 → 入队裁剪（正在裁剪时替换当前图）。 */
  React.useEffect(() => {
    function onPaste(event: ClipboardEvent): void {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            // 粘贴单张：空闲则直接裁剪；忙碌则替换当前待裁图
            if (cropperFileRef.current === null) {
              enqueue([file]);
            } else {
              setCropperFile(file);
            }
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

  /** cropperFile 的 ref 镜像（paste 监听闭包用）。 */
  const cropperFileRef = React.useRef<File | null>(null);
  cropperFileRef.current = cropperFile;

  /** 裁剪确认 → 上传 → 入列 → 处理队列下一张。 */
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
      popNext();
    }
  }

  /** 取消裁剪 → 丢弃当前张 → 处理队列下一张。 */
  function cancelCrop(): void {
    setCropperFile(null);
    popNext();
  }

  /** 删除指定截图。 */
  function remove(index: number): void {
    onChange(value.filter((_, i) => i !== index));
  }

  /** 拖拽排序：把 from 位移到 to 位（其他顺移），第一张即封面。 */
  function reorder(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= value.length || to >= value.length) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  return (
    <div className="shot-uploader">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        style={{ display: 'none' }}
        onChange={pickFile}
      />

      {value.length > 0 ? (
        <div className="shot-uploader__grid">
          {value.map((file, index) => (
            <div
              key={file}
              className={cn('shot-uploader__item', dragOverIndex === index && 'shot-uploader__item--over')}
              draggable
              onDragStart={() => {
                dragIndexRef.current = index;
              }}
              onDragEnd={() => {
                dragIndexRef.current = null;
                setDragOverIndex(null);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOverIndex(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = dragIndexRef.current;
                dragIndexRef.current = null;
                setDragOverIndex(null);
                if (from !== null) reorder(from, index);
              }}
              title="拖拽可调整顺序（第一张为封面）"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={screenshotUrl(file)} alt={`作品截图 ${index + 1}`} loading="lazy" />
              {index === 0 ? <span className="shot-uploader__cover">封面</span> : null}
              <button
                type="button"
                className="shot-uploader__del"
                title="删除这张截图"
                aria-label={`删除截图 ${index + 1}`}
                draggable={false}
                onClick={() => remove(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">还没有截图。上传后第一张会作为作品封面展示；可拖拽调整顺序，支持 Ctrl+V 直接粘贴剪贴板截图。</p>
      )}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={full || uploading || cropperFile !== null}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? '上传中…' : full ? `最多 ${MAX_SCREENSHOTS} 张` : '+ 添加截图（可多选 / Ctrl+V 粘贴）'}
      </button>

      {cropperFile ? (
        <div className="cropper-modal" role="dialog" aria-modal="true" aria-label="裁剪截图">
          <div className="cropper-modal__panel">
            {queueLen > 0 ? <p className="cropper-modal__queue">还有 {queueLen} 张待裁剪，确认后继续</p> : null}
            <ImageCropper file={cropperFile} onCancel={cancelCrop} onConfirm={(blob) => void confirmCrop(blob)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
