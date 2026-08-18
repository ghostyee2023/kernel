'use client';

import * as React from 'react';
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY, type ThemeName } from '@/lib/theme';
import { IconButton } from './Button';

/** 亮/暗主题切换按钮。与 `THEME_INIT_SCRIPT` 共用 storage key 与 data 属性。 */
export function ThemeToggle(): React.JSX.Element {
  const [theme, setTheme] = React.useState<ThemeName>('light');
  const [mounted, setMounted] = React.useState<boolean>(false);

  React.useEffect(() => {
    const current = document.documentElement.getAttribute(THEME_ATTRIBUTE);
    setTheme(current === 'dark' ? 'dark' : 'light');
    setMounted(true);
  }, []);

  const handleToggle = React.useCallback((): void => {
    setTheme((prev) => {
      const next: ThemeName = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute(THEME_ATTRIBUTE, next);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* 隐私模式下 localStorage 不可写，忽略即可 */
      }
      return next;
    });
  }, []);

  const isDark = mounted && theme === 'dark';

  return (
    <IconButton label={isDark ? '切换到浅色主题' : '切换到深色主题'} onClick={handleToggle}>
      {isDark ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </IconButton>
  );
}
