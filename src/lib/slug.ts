/**
 * 短码（slug）生成与校验。
 *
 * 规则（docs/P0-架构与任务分解.md §7.2）：
 *   字符集 Base58（去 0 O I l）· 长度 8 · DB `@unique` 为唯一权威 · 冲突重试 3 次
 */

import { customAlphabet } from 'nanoid';
import {
  BASE58_ALPHABET,
  CUSTOM_SLUG_PATTERN,
  RESERVED_SLUGS,
  SLUG_LENGTH,
  SLUG_MAX_RETRY,
} from './constants';

const nanoSlug = customAlphabet(BASE58_ALPHABET, SLUG_LENGTH);

/**
 * 生成一个随机短码（不保证唯一，唯一性由 DB 索引裁定）。
 */
export function generate(): string {
  return nanoSlug();
}

/**
 * 判断短码是否命中系统保留词（大小写不敏感）。
 */
export function isReserved(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

/**
 * 校验自定义短码格式：3–32 位，首尾为字母数字，且不得命中保留词。
 * P0 仅保留能力，UI 不暴露。
 */
export function isValidCustom(slug: string): boolean {
  if (slug.length < 3 || slug.length > 32) return false;
  if (!CUSTOM_SLUG_PATTERN.test(slug)) return false;
  return !isReserved(slug);
}

/**
 * 生成一个「候选唯一」的短码。
 *
 * 真正的唯一性由调用方在 insert 时捕获 DB 唯一冲突来兜底；这里只负责
 * 跳过保留词并通过 `exists` 回调做一次前置探测，降低冲突概率。
 *
 * @param exists 判定短码是否已被占用的异步回调。
 * @param retry 最大尝试次数，默认 3。
 * @returns 可用的短码。
 * @throws 当连续 `retry` 次都冲突时抛出 `SLUG_CONFLICT` 语义的 Error（由调用方包装为 AppError）。
 */
export async function generateUnique(
  exists: (slug: string) => Promise<boolean>,
  retry: number = SLUG_MAX_RETRY,
): Promise<string> {
  for (let attempt = 1; attempt <= retry; attempt += 1) {
    const candidate = generate();
    if (isReserved(candidate)) continue;
    // eslint-disable-next-line no-await-in-loop -- 需串行探测，冲突概率极低
    const taken = await exists(candidate);
    if (!taken) return candidate;
    console.warn(`[slug][conflict] attempt=${attempt} candidate=${candidate}`);
  }
  throw new Error('SLUG_CONFLICT');
}
