'use strict';

/**
 * 测试运行时预加载钩子（`node --require ./tests/helpers/register.cjs`）。
 *
 * 唯一职责：把 CJS 解析路径上的 `file-type` 重定向到本地桥接层，
 * 绕开「纯 ESM 包无法被 require」的限制。详见 file-type-cjs-bridge.cjs。
 *
 * 仅影响测试进程，不改动任何源码，也不改变被测逻辑——桥接层内部加载的
 * 仍是 node_modules 里的真实 file-type。
 */

const Module = require('node:module');
const path = require('node:path');

const BRIDGE_PATH = path.join(__dirname, 'file-type-cjs-bridge.cjs');
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function patchedResolveFilename(request, ...rest) {
  if (request === 'file-type') return BRIDGE_PATH;
  return originalResolveFilename.call(this, request, ...rest);
};
