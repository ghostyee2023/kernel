/**
 * QA loader 注册入口：Node 22 需要显式 module.register 才会把 loader 挂进链。
 * 用法：node --import tsx --import ./tests/qa/qa-register.mjs --test ...
 */

import { register } from 'node:module';

register(new URL('./qa-next-headers-loader.mjs', import.meta.url).href, import.meta.url);
