/**
 * 作品详情 loading：封面 + 标题 + 正文骨架。
 */
export default function Loading() {
  return (
    <div className="container-wide" aria-busy="true" aria-live="polite">
      <span className="sr-only">加载作品详情…</span>
      <div
        className="skeleton"
        style={{ aspectRatio: '16 / 9', borderRadius: 12, maxWidth: 880, margin: '20px 0' }}
      />
      <div className="skeleton" style={{ height: 28, width: '50%' }} />
      <div className="skeleton" style={{ height: 14, width: '80%', marginTop: 8 }} />
      <div className="skeleton" style={{ height: 200, width: '100%', marginTop: 20 }} />
    </div>
  );
}
