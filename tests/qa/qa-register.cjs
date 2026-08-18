/**
 * QA CJS 预加载钩子：把 CJS require('next/headers') 重定向到本地 stub，
 * 使 Route Handler（以 CJS 方式被 tsx 加载）可脱离 Next 服务器直接调用。
 * 同时复用 file-type 桥接，避免纯 ESM 包被 require。
 *
 * 用法：node --require ./tests/qa/qa-register.cjs --import tsx --test ...
 */

'use strict';

const Module = require('node:module');
const path = require('node:path');

const HEADERS_STUB = path.join(__dirname, 'qa-next-headers-stub.cjs');
const FILE_TYPE_BRIDGE = path.join(__dirname, '..', 'helpers', 'file-type-cjs-bridge.cjs');

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function patchedResolveFilename(request, ...rest) {
  if (request === 'next/headers') return HEADERS_STUB;
  if (request === 'file-type') return FILE_TYPE_BRIDGE;
  return originalResolveFilename.call(this, request, ...rest);
};
