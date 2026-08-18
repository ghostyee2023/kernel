import * as React from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 渲染的标签名，默认 `article`（作品卡片语义）。 */
  as?: 'div' | 'article' | 'section';
}

/** 基础卡片容器（白底 / 圆角 14px / 悬停微抬升）。 */
export function Card({ as = 'article', className, children, ...rest }: CardProps): React.JSX.Element {
  const Tag = as as React.ElementType;
  return (
    <Tag className={cn('card', className)} {...rest}>
      {children}
    </Tag>
  );
}

export type CardBodyProps = React.HTMLAttributes<HTMLDivElement>;

/** 卡片正文区。 */
export function CardBody({ className, children, ...rest }: CardBodyProps): React.JSX.Element {
  return (
    <div className={cn('card__body', className)} {...rest}>
      {children}
    </div>
  );
}

export type SideCardProps = React.HTMLAttributes<HTMLElement>;

/** 详情页右侧信息卡（分享、元信息、生命周期）。 */
export function SideCard({ className, children, ...rest }: SideCardProps): React.JSX.Element {
  return (
    <aside className={cn('side-card', className)} {...rest}>
      {children}
    </aside>
  );
}

export interface MetaRowProps {
  /** 左侧字段名。 */
  label: React.ReactNode;
  /** 右侧字段值。 */
  value: React.ReactNode;
  /** 值是否使用等宽字体。 */
  mono?: boolean;
}

/** 键值对信息行。 */
export function MetaRow({ label, value, mono = false }: MetaRowProps): React.JSX.Element {
  return (
    <div className="meta-row">
      <span>{label}</span>
      <strong className={cn(mono && 'mono')}>{value}</strong>
    </div>
  );
}

export interface EmptyStateProps {
  /** 图标节点（建议 SVG）。 */
  icon?: React.ReactNode;
  /** 主标题。 */
  title: string;
  /** 补充说明。 */
  desc?: React.ReactNode;
  /** 操作区。 */
  action?: React.ReactNode;
}

/** 空状态。 */
export function EmptyState({ icon, title, desc, action }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="empty">
      {icon ? <div className="empty__icon">{icon}</div> : null}
      <h3 className="t-title" style={{ marginBottom: 6 }}>
        {title}
      </h3>
      {desc ? <p className="t-body-sm muted">{desc}</p> : null}
      {action ? <div style={{ marginTop: 18 }}>{action}</div> : null}
    </div>
  );
}
