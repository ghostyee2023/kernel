import * as React from 'react';
import { cn } from '@/lib/cn';

/** 徽章语气，对齐 DESIGN.md §4.3 与 globals.css 的 `.badge--*`。 */
export type BadgeTone = 'campaign' | 'live' | 'expiring' | 'private' | 'unlisted' | 'archived' | 'blocked';

const TONE_CLASS: Record<BadgeTone, string> = {
  campaign: 'badge--campaign',
  live: 'badge--live',
  expiring: 'badge--expiring',
  private: 'badge--private',
  unlisted: 'badge--unlisted',
  archived: 'badge--archived',
  blocked: 'badge--blocked',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** 徽章语气，默认 `campaign`。 */
  tone?: BadgeTone;
  /** 是否在文字前渲染一个状态圆点（`live` 语气会附带呼吸环）。 */
  dot?: boolean;
}

/** 状态徽章：活动标签、可见性、生命周期状态等。 */
export function Badge({ tone = 'campaign', dot = false, className, children, ...rest }: BadgeProps): React.JSX.Element {
  return (
    <span className={cn('badge', TONE_CLASS[tone], className)} {...rest}>
      {dot ? <i className={cn('dot', tone === 'live' && 'dot-live')} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export interface TagProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 是否处于选中态（映射为 `aria-pressed`）。 */
  active?: boolean;
}

/** 可点击的圆角标签（筛选条、技术栈标记）。 */
export function Tag({ active = false, className, type = 'button', children, ...rest }: TagProps): React.JSX.Element {
  return (
    <button type={type} aria-pressed={active} className={cn('tag', className)} {...rest}>
      {children}
    </button>
  );
}

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** 展示名称，取首字符作为占位字母。 */
  name: string;
}

/** 品牌渐变底的文字头像占位（P0 无头像上传）。 */
export function Avatar({ name, className, ...rest }: AvatarProps): React.JSX.Element {
  const initial = name.trim().charAt(0).toUpperCase() || 'K';
  return (
    <span className={cn('avatar', className)} aria-hidden="true" {...rest}>
      {initial}
    </span>
  );
}
