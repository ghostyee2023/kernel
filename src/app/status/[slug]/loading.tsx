/**
 * 作品状态页 loading：状态卡骨架。
 */
export default function Loading() {
  return (
    <div className="container-prose" aria-busy="true" aria-live="polite">
      <span className="sr-only">加载状态页…</span>
      <div className="card">
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="skeleton" style={{ height: 24, width: '60%' }} />
          <div className="skeleton" style={{ height: 14, width: '100%' }} />
          <div className="skeleton" style={{ height: 14, width: '70%' }} />
          <div className="skeleton" style={{ height: 40, width: 160 }} />
        </div>
      </div>
    </div>
  );
}
