import type { NextConfig } from 'next';

/**
 * Next.js 配置 —— P0 本地桩。
 *
 * - `poweredByHeader: false`：不下发 `X-Powered-By`，减少指纹暴露面。
 * - `serverExternalPackages`：`yauzl` 走 Node 原生 require，不进 bundler，
 *   避免流式 ZIP 读取器被打包器改写导致中央目录读取行为异常。
 *   ⬆️ Vercel 试验部署：`@libsql/client` / `@prisma/adapter-libsql` 也列进 external——
 *   @libsql/client 的 ESM 构建含 `sync ^\.\/.*$` 目录级 require（会拖进 README 等
 *   非 JS 文件导致 webpack 打包失败），必须在 Node 运行时 require。
 * - `eslint.ignoreDuringBuilds`：P0 未引入 eslint 配置，构建时跳过 lint 检查。
 *
 * ⬆️ Vercel 试验部署（docs/P0-Vercel试验部署设计.md §1.5 / Q7）：
 *   - `outputFileTracingIncludes`：把 `prisma/fixtures/**` 打进 Serverless 函数包，
 *     否则生产环境 /api/cron/run 的自动 seed（prisma/seed-data.ts）拿不到素材、
 *     静默失败（关键）。
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['yauzl', '@libsql/client', '@prisma/adapter-libsql'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  outputFileTracingIncludes: {
    '/*': ['./prisma/fixtures/**'],
  },
  /**
   * 状态页 URL 重写。
   *
   * 设计文档要求状态页对外暴露为 `/_status/[slug]`
   * （Nginx fallback、保留词表、验收用例均以此为准）。
   * 但 Next.js App Router 会把以下划线开头的文件夹视为「私有文件夹」并排除出路由，
   * 因此真实可路由的文件放在 `src/app/status/[slug]/page.tsx`，
   * 这里用重写把外部契约 URL `/_status/[slug]` 映射到内部路由 `/status/[slug]`。
   */
  async rewrites() {
    return [
      { source: '/_status/:slug', destination: '/status/:slug' },
    ];
  },
};

export default nextConfig;
