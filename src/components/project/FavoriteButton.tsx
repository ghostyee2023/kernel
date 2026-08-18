'use client';

/**
 * 收藏按钮（P3 个人空间）。
 *
 * 两种形态：
 *   - `inline`：详情页与「投一票」并列（复用 .btn-vote 骨架 + 星形图标，区分投票爱心）；
 *   - `overlay`：广场卡片右上角 hover 显示（.fav-overlay，绝对定位，与 card__badges 同级兄弟）。
 *
 * 交互：
 *   - 未登录点击 → 跳 `/login?next=<当前页>`；
 *   - 已登录 → POST /api/projects/{slug}/favorite（toggle），成功后本地切换星标态 + toast + router.refresh()。
 *
 * 可访问性：`aria-label` 随状态变化（收藏 / 取消收藏）；`aria-pressed` 标记激活；
 * overlay 按钮触摸目标 ≥ 40px（hover 设备隐藏、触屏常显，见 T05）。
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ApiEnvelope } from '@/lib/types';

/** 组件属性。 */
export interface FavoriteButtonProps {
  slug: string;
  /** SSR 传入的初始收藏态。 */
  initialFavorited: boolean;
  /** 是否已登录（由服务端传入；false 时点击跳登录）。 */
  isLoggedIn: boolean;
  /** 未登录时的登录回跳地址（缺省 /w/{slug}）。 */
  loginNext?: string;
  /** inline = 详情页按钮；overlay = 卡片右上角星标。 */
  variant?: 'inline' | 'overlay';
  size?: 'sm' | 'md';
}

/** 收藏接口返回。 */
interface FavoriteResponse {
  favorited: boolean;
}

/**
 * 跨组件通知事件名：toggle 成功后会在 window 上派发，
 * 需要本地联动的 client 组件（如 FavoritesPanel 取消时移除卡片）订阅。
 */
export const FAVORITE_CHANGED_EVENT = 'favorite:changed';

/** 收藏事件载荷。 */
export interface FavoriteChangedDetail {
  slug: string;
  projectId?: string;
  favorited: boolean;
}

/** 统一信封解析，失败时抛出中文错误。 */
async function unwrap<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!body.ok) throw new Error(body.error.message);
  return body.data;
}

/** 星形图标（内联 SVG，区分投票爱心）。 */
function StarIcon({ filled }: { filled: boolean }): React.JSX.Element {
  return (
    <svg
      className="fav-star"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.6l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8L12 3.6Z" />
    </svg>
  );
}

/** 渲染收藏按钮。 */
export function FavoriteButton({
  slug,
  initialFavorited,
  isLoggedIn,
  loginNext,
  variant = 'inline',
  size = 'md',
}: FavoriteButtonProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [favorited, setFavorited] = useState<boolean>(initialFavorited);
  const [busy, setBusy] = useState<boolean>(false);

  const next = loginNext ?? `/w/${slug}`;
  const label = favorited ? '取消收藏' : '收藏';

  /** 会话失效时跳登录，并保留返回地址。 */
  const redirectToLogin = (): void => {
    router.push(`/login?next=${encodeURIComponent(next)}`);
  };

  /** 收藏 / 取消收藏主流程。 */
  const handleToggle = async (): Promise<void> => {
    if (!isLoggedIn) {
      redirectToLogin();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/favorite`, { method: 'POST' });
      if (response.status === 401) {
        toast('登录已过期，请重新登录', 'danger');
        redirectToLogin();
        return;
      }
      const data = await unwrap<FavoriteResponse>(response);
      setFavorited(data.favorited);
      toast(data.favorited ? '已收藏' : '已取消收藏', data.favorited ? 'success' : 'default');
      // 跨组件通知（让 FavoritesPanel 取消时本地移除卡片）
      window.dispatchEvent(new CustomEvent<FavoriteChangedDetail>(FAVORITE_CHANGED_EVENT, { detail: { slug, favorited: data.favorited } }));
      // 同步计数卡 / 其它卡片收藏态
      router.refresh();
    } catch (error) {
      toast((error as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  // overlay：卡片右上角星标（图标按钮，触摸目标 40px）
  if (variant === 'overlay') {
    return (
      <button
        type="button"
        className="fav-overlay"
        data-favorited={favorited}
        onClick={() => void handleToggle()}
        disabled={busy}
        aria-label={label}
        aria-pressed={favorited}
        title={isLoggedIn ? label : '登录后即可收藏'}
      >
        <StarIcon filled={favorited} />
      </button>
    );
  }

  // inline：详情页与「投一票」并列的按钮
  return (
    <button
      type="button"
      className={cn('btn-vote', 'fav-inline', size === 'sm' && 'btn-vote-sm')}
      data-favorited={favorited}
      onClick={() => void handleToggle()}
      disabled={busy}
      aria-pressed={favorited}
      title={isLoggedIn ? label : '登录后即可收藏'}
    >
      <StarIcon filled={favorited} />
      <span>{favorited ? '已收藏' : '收藏'}</span>
    </button>
  );
}
