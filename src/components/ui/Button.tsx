import * as React from 'react';
import { cn } from '@/lib/cn';

/** 按钮视觉变体，对齐 DESIGN.md §4.1。 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** 按钮尺寸，对齐 DESIGN.md §4.1（sm 30px / md 36px / lg 44px）。 */
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 视觉变体，默认 `secondary`。 */
  variant?: ButtonVariant;
  /** 尺寸，默认 `md`。 */
  size?: ButtonSize;
  /** 是否撑满父容器宽度。 */
  block?: boolean;
}

/**
 * 通用按钮。所有视觉均来自 globals.css 的 `.btn` 系列语义类，
 * 组件本身不写任何内联颜色，保证主题切换一致。
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block = false, className, type = 'button', style, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn('btn', VARIANT_CLASS[variant], SIZE_CLASS[size], className)}
      style={block ? { width: '100%', ...style } : style}
      {...rest}
    />
  );
});

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 无障碍标签，图标按钮必填。 */
  label: string;
}

/** 仅含图标的方形按钮（导航栏主题切换、模态关闭等场景）。 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={cn('icon-btn', className)} {...rest}>
      {children}
    </button>
  );
});
