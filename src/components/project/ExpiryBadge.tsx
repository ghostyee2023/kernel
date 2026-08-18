/**
 * 有效期徽章。
 *
 * 三态由 `describeExpiry()` 统一裁决，避免各处重复写「还剩几天」的判断逻辑：
 *   live      正常展示剩余天数
 *   expiring  ≤7 天，警示色
 *   archived  已过期/已归档
 */

import { Badge } from '@/components/ui';
import { describeExpiry } from '@/lib/format';

/** 组件属性。 */
export interface ExpiryBadgeProps {
  /** ISO 8601 到期时间。 */
  expireAt: string;
  /** 作品是否已归档（归档优先于时间判断）。 */
  archived?: boolean;
  /** 是否显示状态圆点。 */
  dot?: boolean;
  className?: string;
}

/** 渲染有效期徽章。 */
export function ExpiryBadge({ expireAt, archived = false, dot = true, className }: ExpiryBadgeProps) {
  const info = describeExpiry(expireAt);
  const tone = archived ? 'archived' : info.tone;
  const label = archived ? '已归档' : info.label;

  return (
    <Badge tone={tone} dot={dot} className={className}>
      {label}
    </Badge>
  );
}
