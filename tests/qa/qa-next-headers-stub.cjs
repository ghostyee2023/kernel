/**
 * `next/headers` 的 CJS stub：cookies() 读写 globalThis.__qaCookies（Map）。
 * 测试在调用 route handler 前设置该 Map，即可模拟登录/未登录。
 */

'use strict';

async function cookies() {
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

async function headers() {
  return new Headers();
}

function draftMode() {
  return { isEnabled: false };
}

module.exports = { cookies, headers, draftMode };
