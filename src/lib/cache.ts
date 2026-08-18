/**
 * 通用 TTL 内存缓存工厂。
 *
 * 进程级（module 级）缓存：每个部署实例独立持有一份，不做跨实例同步。
 * 适用于公开 GET 接口的「热数据」缓存（统计数字、列表、榜单），避免每请求打 DB。
 *
 * 设计要点：
 *   - 命中且未过期直接返回缓存值；未命中 / 过期则执行 `compute` 并写入缓存（带 TTL）。
 *   - `compute` 抛错**不会**写入缓存（错误不应被缓存，避免脏错误被复用）。
 *   - `invalidate(key?)` 主动失效：创建类接口写入后调用，避免新数据 30 秒内读不到（脏读）。
 */

/** 单条缓存条目。 */
type Entry<T> = { value: T; expireAt: number };

/** 创建缓存实例的可选配置。 */
export interface TtlCacheOptions {
  /** 缓存有效期（毫秒）。必填。 */
  ttlMs: number;
  /** 可选：缓存最大条目数，超过后按 LRU 简单淘汰（预留字段，当前未强制实现）。 */
  maxEntries?: number;
}

/** 缓存实例对外暴露的能力。 */
export interface TtlCache<T> {
  /** 命中且未过期返回缓存值；否则执行 compute 并写入缓存。 */
  getOrCompute(key: string, compute: () => Promise<T>): Promise<T>;
  /** 主动失效某个 key（创建类接口写入后调用，避免脏读）。不传 key 清全部。 */
  invalidate(key?: string): void;
}

/**
 * 创建一个带 TTL 的进程级内存缓存实例。
 *
 * 建议在 **module 级**创建并复用（与 Next.js Route Handler 的生命周期一致），
 * 这样缓存能在多次请求之间共享；不要在每次请求内新建实例，否则每次都是冷缓存。
 *
 * @param options ttlMs 必填，maxEntries 可选（预留）。
 * @returns 可复用的 TtlCache 实例。
 */
export function createTtlCache<T>(options: TtlCacheOptions): TtlCache<T> {
  const store = new Map<string, Entry<T>>();
  const ttl = options.ttlMs;

  return {
    async getOrCompute(key: string, compute: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const hit = store.get(key);
      if (hit && hit.expireAt > now) {
        return hit.value;
      }
      const value = await compute();
      store.set(key, { value, expireAt: now + ttl });
      return value;
    },
    invalidate(key?: string): void {
      if (key === undefined) {
        store.clear();
      } else {
        store.delete(key);
      }
    },
  };
}
