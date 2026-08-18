/**
 * 作品封面。
 *
 * P0 不做真实截图（禁用 playwright / satori），统一走确定性 SVG 占位：
 * 同一 slug 永远得到同一张图，视觉上有区分度，且零外部依赖。
 *
 * 用 `<img>` 而非 `next/image`：封面是本地 Route Handler 下发的 SVG，
 * 走 next/image 优化管线只会增加一次无谓转码。
 */

import { cn } from '@/lib/cn';

/** 组件属性。 */
export interface CoverPlaceholderProps {
  slug: string;
  title: string;
  /** 服务端下发的封面地址；缺省时按约定拼接。 */
  coverUrl?: string | null;
  className?: string;
}

/** 渲染作品封面。 */
export function CoverPlaceholder({ slug, title, coverUrl, className }: CoverPlaceholderProps) {
  const src = coverUrl && coverUrl.trim() !== '' ? coverUrl : `/api/covers/${slug}.svg`;

  return (
    <div className={cn('card__thumbwrap', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${title} 的封面`} loading="lazy" decoding="async" />
    </div>
  );
}
