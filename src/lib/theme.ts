/**
 * 主题相关的共享常量。
 *
 * 放在独立的非 'use client' 模块中，使 RootLayout（Server Component）
 * 可以安全地引用 `THEME_INIT_SCRIPT`——若从客户端组件导出，Next.js 会把它
 * 转成客户端引用代理，无法在服务端拼接为字符串。
 */

/** 主题取值。 */
export type ThemeName = 'light' | 'dark';

/** 主题持久化使用的 localStorage key（v3：2026-08-21 强制深色为默认，作废旧 v2 key，清除测试期残留的 light 偏好）。 */
export const THEME_STORAGE_KEY = 'kernel-theme-v3';

/** 写在 `<html data-theme>` 上的属性名。 */
export const THEME_ATTRIBUTE = 'data-theme';

/**
 * 阻塞式内联脚本，在首帧绘制前写入 `data-theme`，消除主题闪烁（FOUC）。
 * 优先级：localStorage 显式选择 > 系统 prefers-color-scheme > dark。
 * （2026-08-18 主题打磨：默认切换为深色画廊模式；用户显式选浅色时尊重 localStorage。）
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var s=localStorage.getItem(k);var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=(s==='light'||s==='dark')?s:(m?'dark':'dark');document.documentElement.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},t);}catch(e){document.documentElement.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},'dark');}})();`;
