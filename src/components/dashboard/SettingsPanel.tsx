'use client';

/**
 * 账户设置页（P3.5）—— client 组件。
 *
 * 设计真源：docs/P3-我的后台设计.md §1.6；视觉基准：prototype #view-dashboard（1758-1780 行）。
 * - 账号信息：用户名 / 角色徽章（brand-gradient）/ 注册时间；
 * - 修改密码表单（admin 隐藏 + 说明）：前端校验 新密码 ≥6 且两次一致 → POST /api/auth/password →
 *   成功 toast「密码已更新」+ router.refresh()（会话保持，Q3 不强制重新登录）；错误按 code 展示；
 * - 退出登录：POST /api/auth/logout + router.push('/')。
 */

import * as React from 'react';

import { useRouter } from 'next/navigation';

import { Badge, Button, Field, Input, useToast } from '@/components/ui';
import { MIN_PASSWORD_LEN, roleLabel } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import type { AccountInfo, ApiEnvelope } from '@/lib/types';

/** 组件属性。 */
export interface SettingsPanelProps {
  /** SSR 注入的账号信息（不透出 hash，仅 hasPassword 布尔）；会话失效时为 null。 */
  user: AccountInfo | null;
}

/** 修改密码响应 data。 */
interface PasswordResult {
  changed: boolean;
}

/** 渲染账户设置页。 */
export function SettingsPanel({ user }: SettingsPanelProps): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = React.useState<string>('');
  const [newPassword, setNewPassword] = React.useState<string>('');
  const [confirmPassword, setConfirmPassword] = React.useState<string>('');
  const [error, setError] = React.useState<string>('');
  const [busy, setBusy] = React.useState<boolean>(false);

  // ⚠️ 内联角色判断，禁止 import lib/auth.ts（node:crypto 会进客户端 bundle）。
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  /** 前端校验（新密码 ≥6 / 两次一致）→ 调接口 → code 分支提示。 */
  const submitPassword = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setError('');

    if (newPassword.length < MIN_PASSWORD_LEN) {
      setError(`新密码至少 ${MIN_PASSWORD_LEN} 位`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = (await response.json()) as ApiEnvelope<PasswordResult>;
      if (!body.ok) {
        // 错误按 code 分支展示（message 由服务端按 code 生成，前端不解析文案）
        setError(body.error.message);
        return;
      }

      toast('密码已更新', 'success');
      // 会话保持（Q3），刷新 SSR 侧 hasPassword 状态
      router.refresh();
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setError('网络异常，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  /** 退出登录：清会话后回首页。 */
  const handleLogout = async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 即使请求失败也继续跳转，避免卡在错误态
    }
    router.push('/');
    router.refresh();
  };

  return (
    <div>
      <div className="dash-page-head">
        <h1 className="t-title" style={{ margin: 0 }}>
          账户设置
        </h1>
        <p className="t-body-sm muted" style={{ marginTop: 3 }}>
          管理你的账号信息
        </p>
      </div>

      {/* 账号信息 */}
      <div className="panel settings-panel">
        <div className="panel__head">
          <h3>账号信息</h3>
        </div>
        <div className="panel__body">
          <div className="set-grid">
            <label>用户名</label>
            <div className="t-body-sm">{user?.username || '—'}</div>
          </div>
          <div className="set-grid">
            <label>角色</label>
            <Badge className="role-badge" tone="campaign">
              {roleLabel(user?.role)}
            </Badge>
          </div>
          <div className="set-grid">
            <label>注册时间</label>
            <span className="t-body-sm muted">{user ? formatDate(user.createdAt) : '—'}</span>
          </div>
        </div>
      </div>

      {/* 修改密码（admin 隐藏表单 + 说明，Q2） */}
      <div className="panel settings-panel" style={{ marginTop: 18 }}>
        <div className="panel__head">
          <h3>修改密码</h3>
        </div>
        <div className="panel__body">
          {isAdmin ? (
            <p className="t-body-sm muted" style={{ margin: 0 }}>
              演示管理员账号密码固定为 <code>admin</code> / <code>123456</code>，不支持修改。
            </p>
          ) : (
            <form onSubmit={(event) => void submitPassword(event)} noValidate>
              <Field label="当前密码" htmlFor="pwOld" hint={user?.hasPassword ? undefined : '尚未设置密码，可留空'}>
                <Input
                  id="pwOld"
                  type="password"
                  autoComplete="current-password"
                  placeholder="输入当前密码"
                  className="auth-input"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>
              <Field label="新密码" htmlFor="pwNew" hint={`至少 ${MIN_PASSWORD_LEN} 位`}>
                <Input
                  id="pwNew"
                  type="password"
                  autoComplete="new-password"
                  placeholder={`至少 ${MIN_PASSWORD_LEN} 位`}
                  className="auth-input"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </Field>
              <Field label="确认新密码" htmlFor="pwNew2">
                <Input
                  id="pwNew2"
                  type="password"
                  autoComplete="new-password"
                  placeholder="再次输入"
                  className="auth-input"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </Field>

              {error ? (
                <p className="auth-err show" role="alert" style={{ margin: '0 0 12px' }}>
                  {error}
                </p>
              ) : null}

              <Button type="submit" disabled={busy}>
                {busy ? '保存中…' : '保存修改'}
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* 退出登录 */}
      <div className="settings-panel" style={{ marginTop: 18 }}>
        <Button variant="danger" onClick={() => void handleLogout()}>
          退出登录
        </Button>
      </div>
    </div>
  );
}
