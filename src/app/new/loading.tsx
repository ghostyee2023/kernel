/**
 * 发布页 loading：表单骨架，避免点击「发布作品」后白屏。
 */
export default function Loading() {
  return (
    <div className="container-prose" aria-busy="true" aria-live="polite">
      <span className="sr-only">加载发布页…</span>
      <div className="skeleton" style={{ height: 30, width: '50%', margin: '24px 0 20px' }} />
      <div className="card">
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="skeleton" style={{ height: 44, width: '100%' }} />
          <div className="skeleton" style={{ height: 100, width: '100%' }} />
          <div className="skeleton" style={{ height: 160, width: '100%' }} />
          <div className="skeleton" style={{ height: 44, width: 160 }} />
        </div>
      </div>
    </div>
  );
}
