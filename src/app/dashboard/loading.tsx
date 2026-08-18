/**
 * 个人空间 loading：统计卡 + 作品列表骨架。
 */
export default function Loading() {
  return (
    <div className="dashboard container-wide" aria-busy="true" aria-live="polite">
      <span className="sr-only">加载个人空间…</span>
      <div style={{ display: 'flex', gap: 16, margin: '20px 0' }}>
        {Array.from({ length: 4 }, (_, index) => (
          <div className="card" key={index} style={{ flex: 1 }}>
            <div className="skeleton" style={{ height: 60, width: '100%' }} />
          </div>
        ))}
      </div>
      <div className="dash-joined">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="dash-joined__row" key={index}>
            <div className="skeleton" style={{ width: 88, height: 55, borderRadius: 8 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="skeleton" style={{ height: 16, width: '40%' }} />
              <div className="skeleton" style={{ height: 12, width: '70%' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
