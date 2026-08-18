/**
 * 全局加载态。
 *
 * 用与真实卡片同尺寸的骨架屏而不是转圈 —— 布局不跳动，感知等待更短。
 */

import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

/** 骨架卡片数量：与首屏一页的数量一致。 */
const PLACEHOLDER_COUNT = Math.min(DEFAULT_PAGE_SIZE, 8);

export default function Loading() {
  return (
    <div className="container-wide" aria-busy="true" aria-live="polite">
      <span className="sr-only">正在加载</span>

      <div className="grid">
        {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
          <div className="card" key={index}>
            <div className="skeleton" style={{ aspectRatio: '16 / 10' }} />
            <div className="card__body">
              <div className="skeleton" style={{ height: 18, width: '72%' }} />
              <div className="skeleton" style={{ height: 13, width: '100%' }} />
              <div className="skeleton" style={{ height: 13, width: '54%' }} />
              <div className="card__foot">
                <div className="skeleton" style={{ height: 12, width: 88 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
