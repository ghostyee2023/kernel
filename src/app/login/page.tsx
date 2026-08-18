'use client';

/**
 * 登录页 `/login`（用户名密码展示版）。
 *
 * 对齐原型 `#view-login` 的 auth-card：
 * 品牌 / slogan / 「登录到 Kernel」/ 副文案 / 用户名 / 密码 / 登录按钮 / 错误提示 /
 * 底部演示账号提示（admin / 123456；任意用户名密码可登录）。
 *
 * 成功登录后跳转 `next`（来自 URL，用于投票等需要登录的操作回跳），
 * 无 `next` 时回广场 `/`。
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { useToast } from '@/components/ui';
import type { ApiEnvelope } from '@/lib/types';

/** 登录接口返回的用户信息。 */
interface AuthUser {
  id: string;
  username: string;
  nickname: string;
  role: string;
}

/** 登录表单。 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [username, setUsername] = React.useState<string>('');
  const [password, setPassword] = React.useState<string>('');
  const [error, setError] = React.useState<string>('');
  const [busy, setBusy] = React.useState<boolean>(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;

    setError('');
    if (username.trim() === '' || password === '') {
      setError('请输入用户名和密码');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const body = (await response.json()) as ApiEnvelope<{ user: AuthUser }>;
      if (!body.ok) {
        setError(body.error.message);
        return;
      }

      toast(`欢迎回来，${body.data.user.nickname}`, 'success');
      // 优先回跳 next（投票等需要登录的操作）；否则管理员直进后台，普通用户回广场
      const next = searchParams.get('next');
      if (next && next.startsWith('/')) {
        router.push(next);
      } else if (body.data.user.role === 'ADMIN' || body.data.user.role === 'SUPER_ADMIN') {
        router.push('/admin');
      } else {
        router.push('/');
      }
      router.refresh();
    } catch {
      setError('网络异常，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="logo__mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                fillOpacity=".95"
                fillRule="evenodd"
                d="M12 3.2c4.2 2.7 6.5 5.9 6.5 9.3a6.5 6.5 0 1 1-13 0c0-3.4 2.3-6.6 6.5-9.3Zm0 6.6a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z"
              />
            </svg>
          </span>
          <span>
            Kernel<span className="logo__cn" style={{ marginLeft: 6 }}>创意种子</span>
          </span>
        </div>
        <div className="auth-slogan">Core. Code. Create.</div>
        <div className="auth-title">登录到 Kernel</div>
        <div className="auth-sub">登录后即可发布作品、参与投票、收藏与管理你的项目</div>

        <form onSubmit={(event) => void submit(event)} noValidate>
          <div className="auth-field">
            <label htmlFor="loginUser">用户名</label>
            <input
              className="auth-input"
              id="loginUser"
              name="username"
              placeholder="请输入用户名"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>

          <div className="auth-field" style={{ marginTop: 14 }}>
            <label htmlFor="loginPass">密码</label>
            <input
              className="auth-input"
              id="loginPass"
              name="password"
              type="password"
              placeholder="请输入密码"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <div className={error ? 'auth-err show' : 'auth-err'} role="alert">
              {error}
            </div>
          </div>

          <button
            className="btn btn-primary btn-lg"
            type="submit"
            style={{ width: '100%', marginTop: 10 }}
            disabled={busy}
          >
            {busy ? '登录中…' : '登录'}
          </button>
        </form>

        <div className="auth-foot">
          <span className="muted">还没有账号？</span>
          <span className="auth-link" aria-disabled="true" title="注册功能将在后续版本开放">
            立即注册（即将开放）
          </span>
        </div>

        <div className="auth-meta">
          演示账号：管理员 <code>admin</code> / 密码 <code>123456</code>；普通用户可使用任意用户名 + 任意密码登录。
        </div>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Link className="auth-link" href="/" style={{ fontSize: 12.5 }}>
            ← 返回作品广场
          </Link>
        </div>
      </div>
    </div>
  );
}

/** 登录页（useSearchParams 需要 Suspense 边界）。 */
export default function LoginPage(): React.JSX.Element {
  return (
    <React.Suspense fallback={<div className="auth-wrap" aria-hidden="true" />}>
      <LoginForm />
    </React.Suspense>
  );
}
