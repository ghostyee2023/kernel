import { revalidateTag, unstable_cache } from 'next/cache';

/**
 * 跨实例数据缓存封装（P2 性能优化）。
 *
 * 替代 src/lib/cache.ts 的进程级 Map —— 后者在 Vercel 多实例下各实例独立持有、
 * 无法跨实例共享，实测降不了端到端延迟。这里改用 Next.js 内置的 **Data Cache**
 * （`unstable_cache`）：跨部署实例共享、边缘节点可用、支持 `revalidateTag` 精确失效。
 *
 * 铁律：
 *   1. 仅用于「公开只读」查询；per-user 查询禁止缓存（会串号）。
 *   2. 被包裹的 fn 不得访问 `cookies()` / `headers()`（Data Cache 要求无请求上下文依赖）。
 *   3. 返回值必须可序列化（plain object / 数组 / 基础类型）。
 *   4. 失效统一走 `invalidateTag()`，由写入侧在请求上下文中触发。
 */

/** 缓存选项。 */
export interface DataCacheOptions {
  /** 失效标签；写入侧用 `invalidateTag` 精确失效。 */
  tags?: string[];
  /** 秒；不传则缓存直到被 `invalidateTag` 显式失效。 */
  revalidate?: number;
}

/** 把任意缓存键片段归一为稳定字符串数组（对象按 JSON 序列化，键序稳定）。 */
function stableKey(parts: ReadonlyArray<string | number | object>): string[] {
  return parts.map((part) =>
    typeof part === 'object' && part !== null ? JSON.stringify(part) : String(part),
  );
}

/**
 * 用 Next Data Cache 包裹一次数据获取。
 *
 * @param fn        实际查询（缓存未命中时执行）。
 * @param keyParts  缓存键片段，需能唯一区分不同调用。
 * @param options   tags / revalidate。
 * @returns 缓存命中时直接返回缓存值；未命中则执行 fn 并写入缓存。
 */
export function cached<T>(
  fn: () => Promise<T>,
  keyParts: ReadonlyArray<string | number | object>,
  options: DataCacheOptions = {},
): Promise<T> {
  return unstable_cache(fn, stableKey(keyParts), {
    tags: options.tags,
    revalidate: options.revalidate,
  })();
}

/**
 * 失效指定标签下的全部缓存条目。
 *
 * 必须 **await**：`revalidateTag` 在 Next 15 是异步的，写请求若不等待其完成就返回，
 * 紧随其后的读请求可能命中尚未失效的旧值（竞态）；在 Vercel serverless 下
 * fire-and-forget 的失效甚至可能在函数冻结时直接丢失，导致最长 30–60s 脏数据。
 *
 * 包了一层 try/catch：在非请求上下文（构建期 prefetch、一次性 seed 脚本）下
 * `revalidateTag` 不可用，忽略即可，避免把这些调用路径炸掉。
 */
export async function invalidateTag(tag: string): Promise<void> {
  try {
    await revalidateTag(tag);
  } catch {
    // 非请求上下文（脚本 / 构建期）下 revalidate 不可用，忽略
  }
}
