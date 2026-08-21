/**
 * ImageCropper —— 轻量图片裁剪器（自研，零依赖）。
 *
 * 交互模型：
 *   - 原图居中铺在画布内，滚轮 / +/- 按钮缩放（围绕画布中心，最小 cover、最大 3x）；
 *   - 裁剪框：拖拽内部移动；拖拽四角手柄调整大小；
 *   - 比例预设：自由 / 1:1 / 4:3 / 16:9（切换时以当前宽度为基准、中心锁定重算高度）；
 *   - 确认：按裁剪框在图片像素上的映射区域输出（最长边 ≤ 1600px）→ WebP Blob。
 *
 * 坐标约定：全部交互在画布坐标（CSS 像素）进行；输出时换算回图片像素。
 */

import * as React from 'react';

/** 比例预设。 */
type RatioKey = 'free' | '1:1' | '4:3' | '16:9';
const RATIOS: Record<Exclude<RatioKey, 'free'>, number> = { '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9 };

/** 组件属性。 */
export interface ImageCropperProps {
  /** 待裁剪图片（本地 File）。 */
  file: File;
  /** 取消（返回选图状态）。 */
  onCancel: () => void;
  /** 确认：输出 Blob（WebP）+ 本地预览 URL（objectURL，调用方负责 revoke）。 */
  onConfirm: (blob: Blob, previewUrl: string) => void;
}

/** 裁剪框（画布坐标）。 */
interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 当前拖拽模式。 */
type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

/** 输出最长边（px）。 */
const MAX_OUTPUT_EDGE = 1600;

export function ImageCropper({ file, onCancel, onConfirm }: ImageCropperProps): React.JSX.Element {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);

  const [scale, setScale] = React.useState<number>(1);
  const scaleRef = React.useRef(scale);
  scaleRef.current = scale;

  const [crop, setCrop] = React.useState<CropBox>({ x: 0, y: 0, w: 0, h: 0 });
  const cropRef = React.useRef(crop);
  cropRef.current = crop;

  const [ratio, setRatio] = React.useState<RatioKey>('4:3');
  const ratioRef = React.useRef(ratio);
  ratioRef.current = ratio;

  const dragRef = React.useRef<{ mode: DragMode; startX: number; startY: number; orig: CropBox; origScale: number } | null>(null);

  // 画布实际尺寸（CSS 像素，由容器决定）
  const canvasSize = React.useMemo(() => ({ w: 640, h: 400 }), []);

  /* ---------- 加载图片 ---------- */
  React.useEffect(() => {
    const image = new Image();
    image.onload = () => {
      imgRef.current = image;
      setImg(image);
    };
    image.src = URL.createObjectURL(file);
    return () => {
      URL.revokeObjectURL(image.src);
    };
  }, [file]);

  /* ---------- 图片缩放状态：fit 基线 → 实际显示尺寸 ---------- */
  const fit = React.useMemo(() => {
    if (!img) return { scale: 1, w: 0, h: 0 };
    const { w, h } = canvasSize;
    const pad = 24; // 四周留白
    const scale = Math.min((w - pad * 2) / img.naturalWidth, (h - pad * 2) / img.naturalHeight);
    return { scale: Math.max(0.05, scale), w: img.naturalWidth * Math.max(0.05, scale), h: img.naturalHeight * Math.max(0.05, scale) };
  }, [img, canvasSize]);

  /** 图片显示尺寸（当前缩放系数下的画布坐标）。 */
  const display = React.useMemo(() => {
    return { w: fit.w * scale, h: fit.h * scale };
  }, [fit, scale]);

  /* ---------- 图片初始定位（画布内居中） ---------- */
  const origin = React.useMemo(() => {
    return { x: (canvasSize.w - display.w) / 2, y: (canvasSize.h - display.h) / 2 };
  }, [canvasSize, display]);

  /* ---------- 裁剪框初始化 / 比例变化时重算 ---------- */
  React.useEffect(() => {
    if (!img) return;
    const ratioNum = ratio === 'free' ? cropRef.current.w / Math.max(1, cropRef.current.h) : RATIOS[ratio];
    const w = Math.round(canvasSize.w * 0.8);
    const h = ratio === 'free' ? Math.round(canvasSize.h * 0.6) : Math.round(w / ratioNum);
    const box: CropBox = {
      x: Math.round((canvasSize.w - w) / 2),
      y: Math.round((canvasSize.h - Math.min(h, canvasSize.h * 0.9)) / 2),
      w,
      h: Math.min(h, canvasSize.h * 0.9),
    };
    if (ratio === 'free') {
      box.y = Math.round((canvasSize.h - box.h) / 2);
    } else {
      // 以中心锁定重算（宽度基准）
      const centerY = cropRef.current.y + cropRef.current.h / 2;
      const hh = Math.round(w / ratioNum);
      box.y = Math.round(centerY - hh / 2);
      box.h = hh;
    }
    setCrop(clampCrop(box));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, ratio]);

  /** 裁剪框 clamp 到画布内。 */
  function clampCrop(box: CropBox): CropBox {
    const { w: cw, h: ch } = canvasSize;
    const minEdge = 48;
    const w = Math.min(Math.max(box.w, minEdge), cw);
    const h = Math.min(Math.max(box.h, minEdge), ch);
    const x = Math.min(Math.max(box.x, 0), cw - w);
    const y = Math.min(Math.max(box.y, 0), ch - h);
    return { x, y, w, h };
  }

  /* ---------- 绘制 ---------- */
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !img) return;

    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);
    // 底
    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);
    // 图片
    ctx.drawImage(img, origin.x, origin.y, display.w, display.h);
    // 遮罩（裁剪框外）
    const c = cropRef.current;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvasSize.w, c.y);
    ctx.fillRect(0, c.y + c.h, canvasSize.w, canvasSize.h - c.y - c.h);
    ctx.fillRect(0, c.y, c.x, c.h);
    ctx.fillRect(c.x + c.w, c.y, canvasSize.w - c.x - c.w, c.h);
    // 边框
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(c.x + 0.75, c.y + 0.75, c.w - 1.5, c.h - 1.5);
    // 九宫格辅助线
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(c.x + (c.w * i) / 3, c.y);
      ctx.lineTo(c.x + (c.w * i) / 3, c.y + c.h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c.x, c.y + (c.h * i) / 3);
      ctx.lineTo(c.x + c.w, c.y + (c.h * i) / 3);
      ctx.stroke();
    }
    // 四角手柄
    const hs = 10;
    ctx.fillStyle = '#ffffff';
    for (const [hx, hy] of [
      [c.x, c.y],
      [c.x + c.w, c.y],
      [c.x, c.y + c.h],
      [c.x + c.w, c.y + c.h],
    ]) {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    }
  }, [img, origin, display, canvasSize, crop, scale]);

  /* ---------- 指针交互 ---------- */
  function hitMode(clientX: number, clientY: number): DragMode {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * canvasSize.w;
    const y = ((clientY - rect.top) / rect.height) * canvasSize.h;
    const c = cropRef.current;
    const handle = 14;
    const near = (a: number, b: number) => Math.abs(a - b) <= handle;
    if (near(x, c.x) && near(y, c.y)) return 'nw';
    if (near(x, c.x + c.w) && near(y, c.y)) return 'ne';
    if (near(x, c.x) && near(y, c.y + c.h)) return 'sw';
    if (near(x, c.x + c.w) && near(y, c.y + c.h)) return 'se';
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return 'move';
    return null;
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>): void {
    const mode = hitMode(event.clientX, event.clientY);
    if (!mode) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    canvas?.setPointerCapture(event.pointerId);
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, orig: { ...cropRef.current }, origScale: scaleRef.current };
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = ((event.clientX - drag.startX) / rect.width) * canvasSize.w;
    const dy = ((event.clientY - drag.startY) / rect.height) * canvasSize.h;
    const o = drag.orig;
    let next: CropBox = { ...o };
    if (drag.mode === 'move') {
      next = { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h };
    } else {
      const r = ratioRef.current === 'free' ? null : RATIOS[ratioRef.current];
      if (drag.mode === 'se') {
        next = { ...o, w: o.w + dx, h: r ? (o.w + dx) / r : o.h + dy };
      } else if (drag.mode === 'nw') {
        next = { x: o.x + dx, y: o.y + dy, w: o.w - dx, h: r ? (o.w - dx) / r : o.h - dy };
      } else if (drag.mode === 'ne') {
        next = { x: o.x, y: o.y + dy, w: o.w + dx, h: r ? (o.w + dx) / r : o.h - dy };
      } else if (drag.mode === 'sw') {
        next = { x: o.x + dx, y: o.y, w: o.w - dx, h: r ? (o.w - dx) / r : o.h + dy };
      }
    }
    setCrop(clampCrop(next));
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current;
    canvas?.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  function onWheel(event: React.WheelEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    setScale((s) => Math.min(3, Math.max(0.4, s * (event.deltaY < 0 ? 1.1 : 0.9))));
  }

  /* ---------- 输出 ---------- */
  function confirmCrop(): void {
    const image = imgRef.current ?? img;
    if (!image) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c = cropRef.current;
    // 图片显示（画布坐标）→ 图片像素换算
    const pxScale = image.naturalWidth / display.w;
    const sx = (c.x - origin.x) * pxScale;
    const sy = (c.y - origin.y) * pxScale;
    const sw = c.w * pxScale;
    const sh = c.h * pxScale;
    // 钳制到图片范围
    const sxClamped = Math.max(0, sx);
    const syClamped = Math.max(0, sy);
    const swClamped = Math.min(sw, image.naturalWidth - sxClamped);
    const shClamped = Math.min(sh, image.naturalHeight - syClamped);
    if (swClamped <= 1 || shClamped <= 1) return;

    const edge = Math.max(swClamped, shClamped);
    const outScale = edge > MAX_OUTPUT_EDGE ? MAX_OUTPUT_EDGE / edge : 1;
    const ow = Math.max(1, Math.round(swClamped * outScale));
    const oh = Math.max(1, Math.round(shClamped * outScale));

    const out = document.createElement('canvas');
    out.width = ow;
    out.height = oh;
    const octx = out.getContext('2d');
    if (!octx) return;
    octx.drawImage(image, sxClamped, syClamped, swClamped, shClamped, 0, 0, ow, oh);

    out.toBlob((blob) => {
      if (!blob) return;
      onConfirm(blob, out.toDataURL('image/webp'));
    }, 'image/webp', 0.86);
  }

  return (
    <div className="cropper">
      <div className="cropper__stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          className="cropper__canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          style={{ touchAction: 'none' }}
        />
        <div className="cropper__hint">滚轮或 +/- 缩放 · 拖拽裁剪框移动 · 拖角调整大小</div>
      </div>
      <div className="cropper__bar">
        <div className="cropper__ratios" role="group" aria-label="裁剪比例">
          {(['free', '1:1', '4:3', '16:9'] as RatioKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className="chip"
              aria-pressed={ratio === key}
              onClick={() => setRatio(key)}
            >
              {key === 'free' ? '自由' : key}
            </button>
          ))}
        </div>
        <div className="cropper__zoom">
          <button type="button" className="chip" onClick={() => setScale((s) => Math.max(0.4, s / 1.15))}>
            −
          </button>
          <button type="button" className="chip" onClick={() => setScale((s) => Math.min(3, s * 1.15))}>
            ＋
          </button>
        </div>
        <div className="cropper__actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={confirmCrop}>
            裁剪完成
          </button>
        </div>
      </div>
    </div>
  );
}
