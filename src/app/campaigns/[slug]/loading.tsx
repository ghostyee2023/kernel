/**
 * 活动详情 loading：封面 + 正文 + 侧栏骨架，导航即显示壳。
 */
export default function Loading() {
  return (
    <div className="container-max camp-detail" aria-busy="true" aria-live="polite">
      <span className="sr-only">加载活动详情…</span>
      <div className="camp-detail__head">
        <div className="skeleton" style={{ height: 14, width: 120 }} />
        <div className="skeleton" style={{ height: 32, width: '55%' }} />
        <div className="skeleton" style={{ height: 15, width: '80%' }} />
      </div>
      <div className="camp-detail__body">
        <div className="camp-detail__main">
          <div className="skeleton" style={{ aspectRatio: '16 / 7', borderRadius: 12 }} />
          <div className="skeleton" style={{ height: 80, width: '100%' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {Array.from({ length: 3 }, (_, index) => (
              <div className="card" key={index}>
                <div className="skeleton" style={{ height: 56, width: '100%' }} />
              </div>
            ))}
          </div>
        </div>
        <div className="camp-detail__side">
          <div className="side-card">
            <div className="skeleton" style={{ height: 120, width: '100%' }} />
          </div>
          <div className="side-card">
            <div className="skeleton" style={{ height: 140, width: '100%' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
