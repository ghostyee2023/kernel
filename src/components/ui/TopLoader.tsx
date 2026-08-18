'use client';

/**
 * 全局导航进度条（P0 体验优化，零依赖）。
 *
 * 机制：拦截站内链接点击 → 立即显示顶部进度条（模拟增长，封顶 90%）→
 * `usePathname` 变化时（导航完成）填满至 100% 并淡出。
 * 与下方各路由的 loading.tsx 配合：loading 负责「页面壳先出」，TopLoader 负责
 * 「点击即有反馈」，共同消除「点了没反应 / 白屏卡住」的观感。
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export function TopLoader() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 拦截站内链接点击，启动进度条
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || anchor.target === '_blank') return;
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        // 同页 hash / 同路径同查询不触发（纯锚点滚动）
        if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      } catch {
        return;
      }

      if (timer.current) clearInterval(timer.current);
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      setActive(true);
      setProgress(8);
      timer.current = setInterval(() => {
        setProgress((value) => (value < 90 ? value + Math.random() * 12 : value));
      }, 200);
    };

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // 路由变化（导航完成）→ 收尾
  useEffect(() => {
    if (!active) return;
    if (timer.current) clearInterval(timer.current);
    setProgress(100);
    fadeTimer.current = setTimeout(() => setActive(false), 320);
    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
    // 仅在 pathname 变化时收尾
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!active) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        height: 3,
        width: `${progress}%`,
        background: 'var(--color-primary, #5b8cff)',
        zIndex: 9999,
        pointerEvents: 'none',
        opacity: progress >= 100 ? 0 : 1,
        transition: 'width 200ms ease, opacity 320ms ease',
      }}
    />
  );
}
