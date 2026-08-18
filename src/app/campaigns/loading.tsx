/**
 * 活动广场 loading：导航瞬间显示卡片骨架，避免白屏等待。
 */
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

export default function Loading() {
  return (
    <div className="container-wide" aria-busy="true" aria-live="polite">
      <span className="sr-only">加载活动广场…</span>
      <div className="grid">
        {Array.from({ length: Math.min(DEFAULT_PAGE_SIZE, 8) }, (_, index) => (
          <div className="card" key={index}>
            <div className="skeleton" style={{ aspectRatio: '16 / 9' }} />
            <div className="card__body">
              <div className="skeleton" style={{ height: 18, width: '70%' }} />
              <div className="skeleton" style={{ height: 13, width: '100%' }} />
              <div className="card__foot">
                <div className="skeleton" style={{ height: 12, width: 80 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
