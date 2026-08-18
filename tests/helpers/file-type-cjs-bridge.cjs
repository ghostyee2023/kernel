'use strict';

/**
 * `file-type` 的 CJS→ESM 桥接层（**仅测试期使用**）。
 *
 * 背景：
 *   `file-type@19` 是纯 ESM 包，其 package.json 的 exports 只声明了 `import`
 *   条件，没有 `require` 条件。项目根 package.json 未设置 `"type": "module"`，
 *   因此 tsx 会把 `src/**\/*.ts` 按 CJS 转译，`import { fileTypeFromBuffer }
 *   from 'file-type'` 被降级为 `require('file-type')`，触发
 *   ERR_PACKAGE_PATH_NOT_EXPORTED。
 *
 *   这**不是源码缺陷**：Next.js 构建链路把同一份源码按 ESM 编译，
 *   `next build` 可正常解析（已验证 0 错误）。缺口只存在于测试运行时。
 *
 * 做法：
 *   用真实的动态 `import()` 加载**真包**（不做行为桩），把异步导出重新暴露为
 *   CJS 命名导出。所有被测断言仍然跑在真实的魔数检测实现上。
 *
 * 注意：
 *   `new Function` 包一层是为了拿到一个转译器无法改写成 `require()` 的
 *   真·动态 import；若直接写 `import(...)`，tsx 在 CJS 输出里会把它降级掉。
 */

const dynamicImport = new Function('specifier', 'return import(specifier);');

/** 缓存模块 Promise，避免重复加载。 */
let modulePromise = null;

function loadRealModule() {
  if (modulePromise === null) modulePromise = dynamicImport('file-type');
  return modulePromise;
}

exports.fileTypeFromBuffer = async function fileTypeFromBuffer(input) {
  return (await loadRealModule()).fileTypeFromBuffer(input);
};

exports.fileTypeFromFile = async function fileTypeFromFile(input) {
  return (await loadRealModule()).fileTypeFromFile(input);
};

exports.fileTypeFromStream = async function fileTypeFromStream(input) {
  return (await loadRealModule()).fileTypeFromStream(input);
};
