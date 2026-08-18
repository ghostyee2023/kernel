/**
 * 指标卡（P2 后台概览）：大数字（mono + tabular-nums）+ 标签（可选语义色点）+ 可选副文案。
 */

import * as React from 'react';

import { cn } from '@/lib/cn';

/** 标签色点可选语气（token 色，零 hex）。 */
export type MetricCardTone = 'primary' | 'cyan' | 'magenta' | 'gold' | 'success' | 'warning';

export interface MetricCardProps {
  /** 标签。 */
  label: string;
  /** 大数字（渲染在 `.metric-card__value`，mono + tabular-nums）。 */
  value: React.ReactNode;
  /** 可选副文案。 */
  hint?: React.ReactNode;
  /** 可选语义色点（label 左侧，token 色）。 */
  tone?: MetricCardTone;
}

/** 概览指标卡。 */
export function MetricCard({ label, value, hint, tone }: MetricCardProps): React.JSX.Element {
  return (
    <div className="metric-card">
      <div className="metric-card__label">
        {tone ? <span className={cn('metric-card__dot', `metric-card__dot--${tone}`)} aria-hidden="true" /> : null}
        {label}
      </div>
      <div className="metric-card__value">{value}</div>
      {hint ? <div className="metric-card__hint">{hint}</div> : null}
    </div>
  );
}
