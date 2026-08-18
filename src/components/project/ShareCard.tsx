'use client';

/**
 * 分享卡片：短链 + 复制 + 二维码。
 *
 * 二维码在客户端用 `qrcode` 生成 DataURL —— 避免为一张图新增一条服务端路由，
 * 也免去缓存失效的心智负担。
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

import { Button, SideCard, useToast } from '@/components/ui';

import { SharePoster } from './SharePoster';

/** 组件属性。 */
export interface ShareCardProps {
  /** 完整可访问链接。 */
  url: string;
  /** 展示用短链文本（通常去掉协议前缀）。 */
  displayUrl: string;
  /** 是否套一层 SideCard 外壳（详情页右栏用 true，成功页用 false）。 */
  boxed?: boolean;
  /** 存在时渲染「下载分享海报」按钮（对齐原型分享卡内的 poster-btn）。 */
  poster?: { title: string; slug: string };
}

/** 渲染分享区。 */
export function ShareCard({ url, displayUrl, boxed = true, poster }: ShareCardProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;

    // 不传 color：使用库默认的纯黑白，既保证扫码对比度，
    // 也避免在 TS 里出现硬编码色值（色值真源只允许在 globals.css 的 DESIGN TOKENS 块）
    QRCode.toDataURL(url, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch((error: unknown) => {
        console.warn('[share] 二维码生成失败', error);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  /** 复制链接到剪贴板，降级为 prompt。 */
  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      toast('链接已复制', 'success');
    } catch {
      window.prompt('请手动复制链接', url);
    }
  };

  const body = (
    <div className="share">
      <div className="share__main">
        <div className="linkbox">
          <span title={url}>{displayUrl}</span>
          <Button variant="secondary" size="sm" onClick={() => void handleCopy()}>
            复制
          </Button>
        </div>
        <p className="share__hint">扫码或复制链接，任何人都能立刻打开这件作品。</p>

        {poster ? (
          <SharePoster title={poster.title} slug={poster.slug} url={url} className="share__poster" />
        ) : null}
      </div>

      <div className="qr">
        {qrDataUrl === '' ? (
          <div className="skeleton" style={{ width: '100%', height: '100%' }} aria-label="二维码生成中" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt="作品链接二维码" />
        )}
      </div>
    </div>
  );

  if (!boxed) return body;

  return (
    <SideCard>
      <h3 className="side-card__title">分享这件作品</h3>
      {body}
    </SideCard>
  );
}
