'use client';

/**
 * 文件拖放区。
 *
 * 无障碍要点：外层是 `<button>` 而不是 `<div onClick>`，
 * 天然可 Tab 聚焦、可回车触发，读屏也会念出「按钮」。
 * 真正的 `<input type="file">` 视觉隐藏但保留在 DOM 中。
 *
 * 交互态走 `data-dragging` / `data-disabled`，与设计系统的 `.dropzone[data-*]` 对齐。
 */

import { useCallback, useRef, useState } from 'react';

import { formatBytes } from '@/lib/format';

/** 组件属性。 */
export interface DropzoneProps {
  /** accept 属性值。 */
  accept: string;
  /** 选中文件回调。 */
  onSelect: (file: File) => void;
  /** 当前已选文件。 */
  file?: File | null;
  /** 上传中禁用交互。 */
  disabled?: boolean;
  /** 提示文案。 */
  hint?: string;
}

/** 渲染拖放区。 */
export function Dropzone({ accept, onSelect, file = null, disabled = false, hint }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState<boolean>(false);

  const pick = useCallback((): void => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      setDragging(false);
      if (disabled) return;

      const dropped = event.dataTransfer.files?.[0];
      if (dropped) onSelect(dropped);
    },
    [disabled, onSelect],
  );

  return (
    <>
      <button
        type="button"
        className="dropzone"
        data-dragging={dragging ? 'true' : 'false'}
        data-disabled={disabled ? 'true' : 'false'}
        onClick={pick}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        disabled={disabled}
        aria-label={file ? `已选择 ${file.name}，点击更换` : '点击或拖放文件到此处上传'}
      >
        <span className="dropzone__icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="40" height="40">
            <path
              d="M24 32V12m0 0-8 8m8-8 8 8M10 34v2a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4v-2"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        {file ? (
          <>
            <strong className="dropzone__title">{file.name}</strong>
            <span className="dropzone__hint">{formatBytes(file.size)} · 点击更换文件</span>
          </>
        ) : (
          <>
            <strong className="dropzone__title">点击选择，或把文件拖到这里</strong>
            <span className="dropzone__hint">{hint ?? '支持 ZIP 压缩包与单个 HTML 文件'}</span>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked) onSelect(picked);
          // 复位，保证连续选择同一个文件也能触发 change
          event.target.value = '';
        }}
      />
    </>
  );
}
