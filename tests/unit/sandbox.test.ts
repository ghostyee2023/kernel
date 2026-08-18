/**
 * lib/sandbox.ts 安全响应头与路径归一化测试。
 *
 * 对齐验收点（docs/P0-架构与任务分解.md T04）：
 *   ✅ 六个安全响应头齐全、无 Set-Cookie
 *   ✅ CSP sandbox 指令不含 allow-same-origin
 *   ✅ `.kernel/` 与任何以 `.` 开头的路径段被拒
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SANDBOX_BASE_PATH, SITE_URL } from '../../src/lib/constants';
import {
  buildDetailUrl,
  buildSandboxUrl,
  buildSecurityHeaders,
  cacheControlOf,
  contentTypeOf,
  displayShortLink,
  extOf,
  IFRAME_SANDBOX_ATTR,
  normalizeRequestPath,
} from '../../src/lib/sandbox';

/** 构造一份 html 场景的响应头。 */
function htmlHeaders(): Headers {
  return buildSecurityHeaders(contentTypeOf('index.html'), cacheControlOf('index.html'));
}

describe('sandbox · CSP 隔离（P0 最核心的安全断言）', () => {
  it('CSP 含 sandbox 指令', () => {
    const csp = htmlHeaders().get('content-security-policy') ?? '';
    assert.match(csp, /(^|;\s*)sandbox\s/, `CSP 必须包含 sandbox 指令，实际：${csp}`);
  });

  it('CSP **绝不含 allow-same-origin**（含则整个隔离失效）', () => {
    const csp = htmlHeaders().get('content-security-policy') ?? '';
    assert.equal(csp.includes('allow-same-origin'), false, `CSP 泄漏 allow-same-origin：${csp}`);
  });

  it('iframe sandbox 属性与 CSP sandbox 指令逐字一致，且不含 allow-same-origin', () => {
    const csp = htmlHeaders().get('content-security-policy') ?? '';
    assert.equal(IFRAME_SANDBOX_ATTR.includes('allow-same-origin'), false);
    assert.ok(csp.includes(`sandbox ${IFRAME_SANDBOX_ATTR}`), 'CSP 与 iframe 属性必须一致，否则出现隔离缝隙');
  });

  it('sandbox 允许项只在白名单内（防止后续误加危险 token）', () => {
    const allowed = new Set([
      'allow-scripts',
      'allow-popups',
      'allow-popups-to-escape-sandbox',
      'allow-forms',
    ]);
    for (const token of IFRAME_SANDBOX_ATTR.split(/\s+/)) {
      assert.ok(allowed.has(token), `出现未评审过的 sandbox 允许项：${token}`);
    }
  });

  it('CSP 含 form-action none', () => {
    assert.match(htmlHeaders().get('content-security-policy') ?? '', /form-action 'none'/);
  });
});

describe('sandbox · 六个安全响应头齐全且无 Set-Cookie', () => {
  const REQUIRED: Array<[string, RegExp]> = [
    ['content-security-policy', /sandbox /],
    ['x-content-type-options', /^nosniff$/],
    ['referrer-policy', /^no-referrer$/],
    ['permissions-policy', /camera=\(\)/],
    ['cross-origin-opener-policy', /^same-origin$/],
    ['cross-origin-resource-policy', /^cross-origin$/],
    ['x-frame-options', /^SAMEORIGIN$/],
    ['x-robots-tag', /noindex/],
  ];

  for (const [name, pattern] of REQUIRED) {
    it(`响应头 ${name} 存在且取值正确`, () => {
      const value = htmlHeaders().get(name);
      assert.ok(value !== null, `缺少响应头 ${name}`);
      assert.match(value as string, pattern);
    });
  }

  it('**不下发 Set-Cookie**', () => {
    const headers = htmlHeaders();
    assert.equal(headers.get('set-cookie'), null, '沙箱响应绝不允许携带 Set-Cookie');
    assert.equal(headers.has('set-cookie'), false);
  });

  it('Permissions-Policy 关闭摄像头 / 麦克风 / 定位 / 支付', () => {
    const value = htmlHeaders().get('permissions-policy') ?? '';
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment']) {
      assert.ok(value.includes(`${feature}=()`), `未关闭 ${feature}`);
    }
  });
});

describe('sandbox · MIME 与缓存', () => {
  const mimeCases: Array<[string, string]> = [
    ['index.html', 'text/html; charset=utf-8'],
    ['a/b.css', 'text/css; charset=utf-8'],
    ['a/b.js', 'text/javascript; charset=utf-8'],
    ['a.svg', 'image/svg+xml'],
    ['a.png', 'image/png'],
    ['a.woff2', 'font/woff2'],
    ['a.wasm', 'application/wasm'],
    ['README', 'application/octet-stream'],
    ['a.exe', 'application/octet-stream'],
    ['a.unknownext', 'application/octet-stream'],
  ];

  for (const [file, mime] of mimeCases) {
    it(`${file} → ${mime}`, () => {
      assert.equal(contentTypeOf(file), mime);
    });
  }

  it('未知扩展名一律 octet-stream，配合 nosniff 防止被当脚本执行', () => {
    assert.equal(contentTypeOf('payload.php'), 'application/octet-stream');
    assert.equal(contentTypeOf('payload.jsp'), 'application/octet-stream');
  });

  it('extOf 处理隐藏文件与无扩展名', () => {
    assert.equal(extOf('.env'), '', '以点开头的文件名不应被识别为扩展名');
    assert.equal(extOf('noext'), '');
    assert.equal(extOf('a.b.MinJS'), 'minjs');
  });

  it('HTML 不缓存（下线后必须立刻失效）', () => {
    assert.match(cacheControlOf('index.html'), /no-store|no-cache/);
    assert.match(cacheControlOf('a.htm'), /no-store|no-cache/);
  });

  it('静态资源可缓存但需重验证', () => {
    assert.match(cacheControlOf('a.png'), /max-age=\d+/);
    assert.match(cacheControlOf('a.png'), /must-revalidate/);
  });
});

describe('sandbox · normalizeRequestPath 路径归一化', () => {
  it('空路径 → 空串（由调用方回落到 entryFile）', () => {
    assert.equal(normalizeRequestPath(undefined), '');
    assert.equal(normalizeRequestPath([]), '');
  });

  it('正常多段路径拼成 POSIX 相对路径', () => {
    assert.equal(normalizeRequestPath(['assets', 'style.css']), 'assets/style.css');
    assert.equal(normalizeRequestPath(['a', '', 'b', '.', 'c.js']), 'a/b/c.js');
  });

  const rejected: Array<[string[], string]> = [
    [['..'], '父目录'],
    [['..', '..', 'prisma', 'dev.db'], '验收用例：跳出到 dev.db'],
    [['assets', '..', '..', 'x'], '中途上跳'],
    [['.kernel'], '平台元数据目录'],
    [['.kernel', 'meta.json'], '平台元数据文件'],
    [['.git', 'config'], '隐藏目录'],
    [['.env'], '隐藏文件'],
    [['a\\b'], '反斜杠注入'],
    [['a/b'], '段内斜杠注入'],
    [['%2e%2e'], 'URL 编码的父目录'],
    [['%2e%2e%2f%2e%2e%2fetc%2fpasswd'], '双重编码穿越'],
    [['%00'], 'NUL 字节'],
    [['a%00b'], '内嵌 NUL 字节'],
    [['%E0%A4%A'], '非法百分号编码'],
  ];

  for (const [parts, why] of rejected) {
    it(`拒绝 ${JSON.stringify(parts)}（${why}） → null`, () => {
      assert.equal(normalizeRequestPath(parts), null, `${why} 未被拒绝`);
    });
  }

  it('大小写变体的 .kernel 同样被拒（拒绝以点开头的段）', () => {
    assert.equal(normalizeRequestPath(['.KERNEL', 'meta.json']), null);
    assert.equal(normalizeRequestPath(['.Kernel']), null);
  });
});

describe('sandbox · URL 构造', () => {
  it('buildSandboxUrl 用 subpath 模式且以 / 结尾', () => {
    assert.equal(buildSandboxUrl('Aur9raFx'), `${SITE_URL}${SANDBOX_BASE_PATH}/Aur9raFx/`);
  });

  it('buildDetailUrl 指向 /w/{slug}', () => {
    assert.equal(buildDetailUrl('Aur9raFx'), `${SITE_URL}/w/Aur9raFx`);
  });

  it('displayShortLink 去掉协议与尾斜杠，便于大字号展示', () => {
    assert.equal(displayShortLink('Aur9raFx'), 'localhost:3000/sandbox/Aur9raFx');
  });
});
