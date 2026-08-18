import * as React from 'react';
import { cn } from '@/lib/cn';

export interface FieldProps {
  /** 字段标签文案。 */
  label: string;
  /** 关联控件的 id（用于 `<label for>`）。 */
  htmlFor?: string;
  /** 是否必填，为 true 时在标签后渲染星号。 */
  required?: boolean;
  /** 辅助说明文案。 */
  hint?: React.ReactNode;
  /** 错误文案；存在时覆盖 hint 展示。 */
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}

/** 表单字段容器：标签 + 控件 + 提示/错误。 */
export function Field({
  label,
  htmlFor,
  required = false,
  hint,
  error = null,
  className,
  children,
}: FieldProps): React.JSX.Element {
  return (
    <div className={cn('field', className)}>
      <label htmlFor={htmlFor}>
        {label}
        {required ? <span style={{ color: 'var(--color-danger)' }}> *</span> : null}
      </label>
      {children}
      {error ? <p className="err">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** 是否为非法值，映射到 `aria-invalid` 触发错误态样式。 */
  invalid?: boolean;
}

/** 单行文本输入框。 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn('input', className)} {...rest} />;
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** 是否为非法值，映射到 `aria-invalid`。 */
  invalid?: boolean;
}

/** 多行文本域。 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className, ...rest },
  ref,
) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn('textarea', className)} {...rest} />;
});

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/** 下拉选择框。 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cn('select', className)} {...rest} />;
});

export interface RadioCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 是否选中。 */
  active?: boolean;
  /** 主标题。 */
  title: string;
  /** 副标题描述。 */
  desc?: string;
}

/** 卡片式单选项（可见性选择、TTL 选择）。 */
export function RadioCard({
  active = false,
  title,
  desc,
  className,
  type = 'button',
  ...rest
}: RadioCardProps): React.JSX.Element {
  return (
    <button type={type} role="radio" aria-checked={active} className={cn('radio-card', className)} {...rest}>
      <strong style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{title}</strong>
      {desc ? <span style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{desc}</span> : null}
    </button>
  );
}
