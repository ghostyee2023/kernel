/**
 * 发布页 `/new`。
 *
 * 页面本身是 Server Component，负责：
 *   1. 登录引导 —— 未登录时渲染引导卡（发布必须登录，docs/03 §3.1）；
 *   2. 标题区与说明 —— 已登录时渲染 `<UploadWizard />`（客户端三步状态机）。
 *
 * 边界：真正的三步状态机在 `<UploadWizard />` 里，这里不碰任何上传逻辑。
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { UploadWizard } from '@/components/upload';
import { getSession } from '@/lib/auth';
import { MAX_UPLOAD_BYTES, MAX_ZIP_ENTRIES } from '@/lib/constants';
import { formatBytes } from '@/lib/format';

export const metadata: Metadata = {
  title: '发布作品',
  description: '上传 ZIP 或单个 HTML，一分钟拿到可分享的短链。',
};

/** 未登录引导卡：复用 auth-* / side-card / btn 样式。 */
function LoginGuide() {
  return (
    <div className="publish-login-guide">
      <div className="side-card">
        <span className="badge badge--campaign">发布前先登录</span>
        <h2 className="auth-title">登录后即可发布作品</h2>
        <p className="auth-sub">
          发布作品、续期与下线管理都需要登录 Kernel 账号。
          <br />
          登录后自动回到发布页，已填内容不会丢失。
        </p>
        <Link className="btn btn-primary btn-lg" href="/login?next=/new" style={{ width: '100%' }}>
          去登录
        </Link>
        <Link className="auth-link" href="/">
          ← 返回作品广场
        </Link>
      </div>
    </div>
  );
}

export default async function NewProjectPage() {
  const session = await getSession();

  return (
    <div className="container-prose publish-page">
      <header className="publish-page__head">
        <h1 className="t-display-lg">种下一颗新种子</h1>
        <p className="muted">
          支持 ZIP 压缩包、单个 HTML 文件与外部链接。单次最大{' '}
          <strong className="mono">{formatBytes(MAX_UPLOAD_BYTES)}</strong>、最多{' '}
          <strong className="mono">{MAX_ZIP_ENTRIES}</strong> 个文件；
          所有内容都会在独立沙箱里运行，不会拿到站点的 Cookie。
        </p>
      </header>

      {session ? <UploadWizard /> : <LoginGuide />}
    </div>
  );
}
