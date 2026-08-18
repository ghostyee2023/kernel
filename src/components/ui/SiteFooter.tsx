import * as React from 'react';

/** 站点页脚：品牌口号 + 版本信息。 */
export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="site-footer">
      <div className="container-max site-footer__meta">
        <div className="site-footer__brand">
          <span className="logo__mark" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                fillOpacity=".95"
                fillRule="evenodd"
                d="M12 3.2c4.2 2.7 6.5 5.9 6.5 9.3a6.5 6.5 0 1 1-13 0c0-3.4 2.3-6.6 6.5-9.3Zm0 6.6a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z"
              />
            </svg>
          </span>
          <span>Kernel · 创意种子</span>
        </div>
        <p className="site-footer__slogan">Core. Code. Create.</p>
      </div>
    </footer>
  );
}
