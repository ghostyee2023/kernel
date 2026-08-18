/**
 * QA ESM loader：把 `next/headers` 重定向到本地 stub，
 * 使 Route Handler 可以在无 Next 服务器的情况下直接调用（验证鉴权边界）。
 *
 * 用法：node --import tsx --import ./tests/qa/qa-loader.mjs --test ...
 * （tsx 之后注册，loaders 链式调用，本 loader 先于 tsx 的 resolve 被调用）
 */

const STUB_URL = new URL('./qa-next-headers-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/headers') {
    return { url: STUB_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
