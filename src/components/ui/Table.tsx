/**
 * 通用表格原语（P2 后台）。样式走 globals.css 的 `.admin-table` 系列类，
 * 颜色一律 `var()`（零 hex）。
 */

import * as React from 'react';

import { cn } from '@/lib/cn';

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
}

/** 表格容器（横向滚动由外层 `.admin-table-scroll` 控制）。 */
export function Table({ className, children, ...rest }: TableProps): React.JSX.Element {
  return (
    <table className={cn('admin-table', className)} {...rest}>
      {children}
    </table>
  );
}

export interface THeadProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  children: React.ReactNode;
}

export function THead({ className, children, ...rest }: THeadProps): React.JSX.Element {
  return (
    <thead className={cn('admin-table__head', className)} {...rest}>
      {children}
    </thead>
  );
}

export interface TBodyProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  children: React.ReactNode;
}

export function TBody({ className, children, ...rest }: TBodyProps): React.JSX.Element {
  return (
    <tbody className={cn('admin-table__body', className)} {...rest}>
      {children}
    </tbody>
  );
}

export interface TrProps extends React.HTMLAttributes<HTMLTableRowElement> {
  children: React.ReactNode;
}

export function Tr({ className, children, ...rest }: TrProps): React.JSX.Element {
  return (
    <tr className={cn('admin-table__row', className)} {...rest}>
      {children}
    </tr>
  );
}

export interface ThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  children?: React.ReactNode;
}

export function Th({ className, children, ...rest }: ThProps): React.JSX.Element {
  return (
    <th className={cn('admin-table__th', className)} {...rest}>
      {children}
    </th>
  );
}

export interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  children?: React.ReactNode;
}

export function Td({ className, children, ...rest }: TdProps): React.JSX.Element {
  return (
    <td className={cn('admin-table__td', className)} {...rest}>
      {children}
    </td>
  );
}
