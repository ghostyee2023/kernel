/**
 * 展示层格式化的唯一出口。
 *
 * 约定（docs/P0-架构与任务分解.md §7.5）：
 *   DB 存 UTC · API 出参 ISO 8601 UTC 字符串 · 前端统一按 Asia/Shanghai 展示
 */

import { EXPIRING_SOON_DAYS } from './constants';

const SHANGHAI = 'Asia/Shanghai';

/** 一天的毫秒数。 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 格式化字节数为人类可读字符串。
 *
 * @param bytes 字节数。
 * @returns 例：`1.2 MB`、`860 KB`、`0 B`。
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

/**
 * 把 ISO 时间串按 Asia/Shanghai 格式化为 `YYYY-MM-DD`。
 *
 * @param iso ISO 8601 时间字符串或 Date。
 * @returns 例：`2026-08-06`；输入非法时返回 `—`。
 */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const pick = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/**
 * 把 ISO 时间串按 Asia/Shanghai 格式化为 `YYYY-MM-DD HH:mm`。
 */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const pick = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

/**
 * 计算距离目标时间的剩余天数（向上取整，已过期返回 0）。
 *
 * @param iso 目标时间。
 * @param now 当前时间，默认 `Date.now()`（便于测试注入）。
 */
export function daysUntil(iso: string | Date | null | undefined, now: number = Date.now()): number {
  if (!iso) return 0;
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return 0;
  const diff = date.getTime() - now;
  return diff <= 0 ? 0 : Math.ceil(diff / MS_PER_DAY);
}

/** 过期状态语气。 */
export type ExpiryTone = 'live' | 'expiring' | 'archived';

/** 过期徽章展示信息。 */
export interface ExpiryInfo {
  tone: ExpiryTone;
  label: string;
  days: number;
}

/**
 * 根据到期时间计算徽章语气与文案。
 * 剩余 ≤ 7 天转为 warning 语气，已过期为 archived。
 */
export function describeExpiry(iso: string | Date | null | undefined, now: number = Date.now()): ExpiryInfo {
  const days = daysUntil(iso, now);
  if (days <= 0) return { tone: 'archived', label: '已过期', days: 0 };
  if (days <= EXPIRING_SOON_DAYS) return { tone: 'expiring', label: `${days} 天后过期`, days };
  return { tone: 'live', label: `剩余 ${days} 天`, days };
}

/**
 * 格式化整数计数（千分位 + tabular-nums 由 CSS 负责）。
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.trunc(value)));
}

/**
 * 截断过长文本并追加省略号。
 *
 * @param text 原文。
 * @param max 最大保留字符数。
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * 计算到期时间 = 起点 + ttlDays 自然日。
 *
 * @param ttlDays 保留天数。
 * @param from 起点，默认当前时间。
 */
export function computeExpireAt(ttlDays: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + ttlDays * MS_PER_DAY);
}
