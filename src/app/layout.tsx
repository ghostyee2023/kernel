import type { Metadata, Viewport } from 'next';
import * as React from 'react';
import { Nav, type SessionUser } from '@/components/ui/Nav';
import { SiteFooter } from '@/components/ui/SiteFooter';
import { ToastProvider } from '@/components/ui/Toast';
import { TopLoader } from '@/components/ui/TopLoader';
import { getSession } from '@/lib/auth';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Kernel · 创意种子',
    template: '%s · Kernel 创意种子',
  },
  description: '每一件杰作，都始于一颗种子。上传你的静态作品，一分钟拿到可分享的短链。',
  applicationName: 'Kernel',
  authors: [{ name: 'Kernel' }],
  keywords: ['静态作品', '创意', '发布', '短链', 'Kernel'],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 使用 rgb() 而非十六进制，遵守「站内不出现硬编码 hex」的约定
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'rgb(255, 255, 255)' },
    { media: '(prefers-color-scheme: dark)', color: 'rgb(11, 12, 15)' },
  ],
};

/**
 * 读取当前会话用户（昵称展示用），未登录返回 null。
 *
 * P0-B 性能优化：不再查 DB 取 nickname，直接用 session 中的 username 做显示名，
 * 省去每次请求的 prisma.user.findUnique 往返。
 * SessionPayload 含 username/role，此处映射到 Nav 所需的 { nickname, role }。
 */
async function resolveSessionUser(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session) return null;
  return { nickname: session.username, role: session.role };
}

/** 根布局：主题初始化脚本 + 导航 + 内容 + 页脚 + Toast 容器。 */
export default async function RootLayout({ children }: { children: React.ReactNode }): Promise<React.JSX.Element> {
  const sessionUser = await resolveSessionUser();

  return (
    <html lang="zh-CN" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* 首帧前写入 data-theme，避免深色主题闪烁 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ToastProvider>
          <TopLoader />
          <Nav sessionUser={sessionUser} />
          <main id="main">{children}</main>
          <SiteFooter />
        </ToastProvider>
      </body>
    </html>
  );
}
