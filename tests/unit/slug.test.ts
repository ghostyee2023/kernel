/**
 * lib/slug.ts 单元测试。
 *
 * 对齐验收点（docs/P0-架构与任务分解.md T02）：
 *   ✅ 连续生成 10000 个 slug 无重复、无保留词、无 `0OIl`
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BASE58_ALPHABET, RESERVED_SLUGS, SLUG_LENGTH } from '../../src/lib/constants';
import { generate, generateUnique, isReserved, isValidCustom } from '../../src/lib/slug';

const SAMPLE_SIZE = 10_000;

describe('slug · 生成规则', () => {
  it('字符集不含易混淆字符 0 O I l', () => {
    for (const ch of '0OIl') {
      assert.equal(BASE58_ALPHABET.includes(ch), false, `字符集不应包含 ${ch}`);
    }
    assert.equal(BASE58_ALPHABET.length, 58, 'Base58 字符集应为 58 个字符');
    assert.equal(new Set(BASE58_ALPHABET).size, 58, 'Base58 字符集不应有重复字符');
  });

  it(`连续生成 ${SAMPLE_SIZE} 个：长度恒为 8、无 0OIl、无重复、无保留词`, () => {
    const seen = new Set<string>();
    const forbidden = /[0OIl]/;

    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      const slug = generate();
      assert.equal(slug.length, SLUG_LENGTH, `第 ${i} 个 slug 长度应为 ${SLUG_LENGTH}：${slug}`);
      assert.equal(forbidden.test(slug), false, `第 ${i} 个 slug 含禁用字符：${slug}`);
      for (const ch of slug) {
        assert.ok(BASE58_ALPHABET.includes(ch), `第 ${i} 个 slug 含字符集外字符 ${ch}：${slug}`);
      }
      assert.equal(seen.has(slug), false, `第 ${i} 个 slug 重复：${slug}`);
      assert.equal(isReserved(slug), false, `第 ${i} 个 slug 命中保留词：${slug}`);
      seen.add(slug);
    }

    assert.equal(seen.size, SAMPLE_SIZE);
  });
});

describe('slug · 保留词', () => {
  it('保留词判定大小写不敏感', () => {
    assert.equal(isReserved('api'), true);
    assert.equal(isReserved('API'), true);
    assert.equal(isReserved('Admin'), true);
    assert.equal(isReserved('_status'), true);
    assert.equal(isReserved('sandbox'), true);
    assert.equal(isReserved('notreserved'), false);
  });

  it('保留词表覆盖全部路由前缀，防止短码撞路由', () => {
    for (const seg of ['api', 'w', 'new', 'sandbox', '_status', '_next']) {
      assert.ok(RESERVED_SLUGS.has(seg), `路由前缀 ${seg} 必须在保留词表中`);
    }
  });
});

describe('slug · 自定义短码校验', () => {
  const cases: Array<[string, boolean, string]> = [
    ['ab', false, '短于 3 位'],
    ['abc', true, '恰好 3 位'],
    ['a'.repeat(32), true, '恰好 32 位'],
    ['a'.repeat(33), false, '超过 32 位'],
    ['-abc', false, '首字符非字母数字'],
    ['abc-', false, '尾字符非字母数字'],
    ['my-cool_demo1', true, '中间允许 - 与 _'],
    ['my demo', false, '不允许空格'],
    ['my.demo', false, '不允许点号'],
    ['api', false, '命中保留词'],
    ['ADMIN', false, '命中保留词（大写）'],
  ];

  for (const [input, expected, why] of cases) {
    it(`${JSON.stringify(input)} → ${expected}（${why}）`, () => {
      assert.equal(isValidCustom(input), expected);
    });
  }
});

describe('slug · generateUnique 冲突重试', () => {
  it('首次不冲突时直接返回', async () => {
    let calls = 0;
    const slug = await generateUnique(async () => {
      calls += 1;
      return false;
    });
    assert.equal(calls, 1);
    assert.equal(slug.length, SLUG_LENGTH);
  });

  it('前两次冲突、第三次成功 → 返回第三个候选', async () => {
    let calls = 0;
    const slug = await generateUnique(async () => {
      calls += 1;
      return calls < 3;
    }, 3);
    assert.equal(calls, 3);
    assert.equal(slug.length, SLUG_LENGTH);
  });

  it('连续冲突到达重试上限 → 抛 SLUG_CONFLICT', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        generateUnique(async () => {
          calls += 1;
          return true;
        }, 3),
      /SLUG_CONFLICT/,
    );
    assert.equal(calls, 3, '应恰好探测 3 次');
  });
});
