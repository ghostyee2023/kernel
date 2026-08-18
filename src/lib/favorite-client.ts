/**
 * 收藏集合客户端缓存（P1 流式优化）。
 *
 * 背景：广场每张卡片挂载时都要知道「自己是否被当前用户收藏」。
 * 若逐卡去查 `/api/favorites` 会发 N 次请求；但 per-user 收藏集合对整页是一致的，
 * 只需拉取一次。这里用模块级单例 Promise 缓存：首个组件触发 `fetch('/api/favorites')`，
 * 并发挂载的其余组件共享同一次 in-flight 请求；结果落为 `Set<string>` 供各卡 O(1) 命中判断。
 *
 * 失效：toggle 成功后调用 `invalidateFavoriteCache()`，让下一次挂载重新拉取最新集合，
 * 保证跨组件收藏态一致（如收藏面板移除卡片、详情页星标联动）。
 */

/** 进行中 / 已落地的收藏 id 集合缓存。 */
let cachePromise: Promise<Set<string>> | null = null;
let cacheValue: Set<string> | null = null;

/** 收藏接口返回结构（对齐 /api/favorites 的 ApiEnvelope）。 */
interface FavoritesEnvelope {
  ok: boolean;
  data?: { ids?: string[] };
}

/** 拉取当前登录用户的收藏 id 集合（未登录返回空集，不报错）。 */
export function getFavoriteIds(): Promise<Set<string>> {
  if (cacheValue) return Promise.resolve(cacheValue);
  if (cachePromise) return cachePromise;

  cachePromise = fetch('/api/favorites', { headers: { accept: 'application/json' } })
    .then((response) => {
      if (!response.ok) throw new Error(`favorites ${response.status}`);
      return response.json() as Promise<FavoritesEnvelope>;
    })
    .then((body) => {
      const ids = new Set<string>(body?.data?.ids ?? []);
      cacheValue = ids;
      cachePromise = null;
      return ids;
    })
    .catch((error: unknown) => {
      cachePromise = null;
      if (process.env.NODE_ENV !== 'production') {
        console.error('[favorite-client] 拉取收藏集合失败', error);
      }
      return new Set<string>();
    });

  return cachePromise;
}

/** toggle 成功后失效缓存，下一次挂载重新拉取最新集合。 */
export function invalidateFavoriteCache(): void {
  cacheValue = null;
  cachePromise = null;
}
