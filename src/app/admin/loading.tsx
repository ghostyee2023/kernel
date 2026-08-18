/**
 * 管理后台 loading：覆盖 /admin 下全部子路由（作品/用户/风控/活动…）。
 */
export default function Loading() {
  return (
    <div className="container-wide" aria-busy="true" aria-live="polite">
      <span className="sr-only">加载管理后台…</span>
      <div className="skeleton" style={{ height: 28, width: '30%', margin: '20px 0' }} />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {Array.from({ length: 6 }, (_, index) => (
          <div className="card" key={index}>
            <div className="skeleton" style={{ height: 72, width: '100%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
