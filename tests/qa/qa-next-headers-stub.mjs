/**
 * `next/headers` 的最小 stub：cookies() 读写 `globalThis.__qaCookies`（Map）。
 * 测试在调用 route handler 前设置该 Map，即可模拟登录/未登录。
 */

export async function cookies() {
  const store = (globalThis.__qaCookies ??= new Map());
  return {
    get(name) {
      const value = store.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set(name, value) {
      store.set(name, value);
    },
    delete(name) {
      store.delete(name);
    },
  };
}

export async function headers() {
  return new Headers();
}

export function draftMode() {
  return { isEnabled: false };
}
