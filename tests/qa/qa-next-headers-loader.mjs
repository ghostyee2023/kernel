/**
 * ESM loader（debug）：把 `next/headers` 重定向到本地 stub。
 */

const STUB_URL = new URL('./qa-next-headers-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/headers') {
    console.error('[qa-loader] intercepting next/headers ->', STUB_URL);
    return { url: STUB_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === STUB_URL) {
    console.error('[qa-loader] loading stub', url);
  }
  return nextLoad(url, context);
}
