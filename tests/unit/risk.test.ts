/**
 * 单测：风控规则引擎（P2 风控模块）。
 *
 * 纯函数测试，不碰 DB —— 验证 4 条规则与 evaluateRisk 聚合：
 *   - 同 IP 高频（1min 窗口 ≥5 票 → +30）
 *   - 同 IP 多账号（24h 去重账号 ≥3 → +25）
 *   - 同设备多账号（24h 去重账号 ≥3 → +35）
 *   - 秒级连投（同设备相邻间隔 ≤3s 连续 ≥3 条 → +20）
 *   - evaluateRisk：多条命中求和封顶 100、suspicious 阈值 30
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateRisk,
  ruleDeviceMultiAccount,
  ruleIpHighFreq,
  ruleIpMultiAccount,
  ruleRapidConsecutive,
} from '../../src/lib/risk-service';
import type { RiskVoteLike } from '../../src/lib/types';

/** 构造一条规则入参「票」。 */
function vote(userId: string, createdAt: Date | string, overrides: Partial<RiskVoteLike> = {}): RiskVoteLike {
  return { userId, ip: '203.0.113.10', deviceHash: 'dev-x', createdAt, ...overrides };
}

const NOW = new Date('2026-08-06T10:00:00.000Z');
const SEC = 1000;

test('ruleIpHighFreq：1min 窗口 4 票不触发，5 票触发 +30', () => {
  const four = Array.from({ length: 4 }, (_, i) => vote(`u${i}`, new Date(NOW.getTime() - i * 5 * SEC)));
  assert.equal(ruleIpHighFreq(four, { now: NOW }).length, 0);

  const five = [...four, vote('u4', NOW)];
  const hits = ruleIpHighFreq(five, { now: NOW });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].code, 'IP_HIGH_FREQ');
  assert.equal(hits[0].score, 30);
  assert.match(hits[0].reason, /5 次/);
});

test('ruleIpMultiAccount：同 IP 2 个账号不触发，3 个触发 +25', () => {
  const two = [vote('u1', NOW), vote('u2', NOW)];
  assert.equal(ruleIpMultiAccount(two, { now: NOW }).length, 0);

  const three = [...two, vote('u3', NOW)];
  const hits = ruleIpMultiAccount(three, { now: NOW });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].code, 'IP_MULTI_ACCOUNT');
  assert.equal(hits[0].score, 25);
  assert.match(hits[0].reason, /3 个账号/);
});

test('ruleDeviceMultiAccount：同设备 2 个账号不触发，3 个触发 +35', () => {
  const two = [vote('u1', NOW, { deviceHash: 'dev-x' }), vote('u2', NOW, { deviceHash: 'dev-x' })];
  assert.equal(ruleDeviceMultiAccount(two, { now: NOW }).length, 0);

  const three = [...two, vote('u3', NOW, { deviceHash: 'dev-x' })];
  const hits = ruleDeviceMultiAccount(three, { now: NOW });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].code, 'DEVICE_MULTI_ACCOUNT');
  assert.equal(hits[0].score, 35);
  assert.match(hits[0].reason, /3 个账号/);
});

test('ruleRapidConsecutive：同设备相邻 ≤3s 连续 3 条触发 +20', () => {
  const rapid = [
    vote('u1', new Date(NOW.getTime() - 2 * SEC), { deviceHash: 'dev-rapid' }),
    vote('u2', new Date(NOW.getTime() - 1 * SEC), { deviceHash: 'dev-rapid' }),
    vote('u3', NOW, { deviceHash: 'dev-rapid' }),
  ];
  const hits = ruleRapidConsecutive(rapid, { now: NOW });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].code, 'RAPID_CONSECUTIVE');
  assert.equal(hits[0].score, 20);
  assert.match(hits[0].reason, /连续投票 3 次/);
});

test('ruleRapidConsecutive：相邻间隔 >3s 不触发；仅 2 条不触发', () => {
  const slow = [
    vote('u1', new Date(NOW.getTime() - 10 * SEC), { deviceHash: 'dev-slow' }),
    vote('u2', new Date(NOW.getTime() - 5 * SEC), { deviceHash: 'dev-slow' }),
    vote('u3', NOW, { deviceHash: 'dev-slow' }),
  ];
  assert.equal(ruleRapidConsecutive(slow, { now: NOW }).length, 0);

  const two = [
    vote('u1', new Date(NOW.getTime() - 1 * SEC), { deviceHash: 'dev-two' }),
    vote('u2', NOW, { deviceHash: 'dev-two' }),
  ];
  assert.equal(ruleRapidConsecutive(two, { now: NOW }).length, 0);
});

test('ruleRapidConsecutive：乱序输入按 createdAt 倒序计算（与调用方一致）', () => {
  // 输入乱序，但相邻时间差仍 ≤3s → 应触发
  const shuffled = [
    vote('u1', NOW, { deviceHash: 'dev-r' }),
    vote('u2', new Date(NOW.getTime() - 3 * SEC), { deviceHash: 'dev-r' }),
    vote('u3', new Date(NOW.getTime() - 1 * SEC), { deviceHash: 'dev-r' }),
  ];
  const hits = ruleRapidConsecutive(shuffled, { now: NOW });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].score, 20);
});

test('evaluateRisk：单规则命中 suspicious=false；达阈值 suspicious=true', () => {
  const none = evaluateRisk({
    userId: 'u1',
    ip: '203.0.113.10',
    sameIpRecent: [vote('u1', NOW)],
    sameIpAll: [vote('u1', NOW)],
    sameDeviceAll: [vote('u1', NOW, { deviceHash: 'dev-x' })],
    now: NOW,
  });
  assert.equal(none.score, 0);
  assert.equal(none.suspicious, false);
  assert.equal(none.reasons.length, 0);

  // 同 IP 5 票（同一用户，避免同 IP 多账号规则干扰）→ IP_HIGH_FREQ(+30) → suspicious
  const five = Array.from({ length: 5 }, (_, i) => vote('u1', new Date(NOW.getTime() - i * 5 * SEC)));
  const triggered = evaluateRisk({
    userId: 'u1',
    ip: '203.0.113.10',
    sameIpRecent: five,
    sameIpAll: five,
    sameDeviceAll: [vote('u1', NOW)],
    now: NOW,
  });
  assert.equal(triggered.score, 30);
  assert.equal(triggered.suspicious, true);
  assert.equal(triggered.reasons.some((r) => r.code === 'IP_HIGH_FREQ'), true);
});

test('evaluateRisk：多规则命中求和，封顶 100', () => {
  // 同设备 3 账号(35) + 同 IP 3 账号(25) + 秒级连投(20) = 80
  const threeUsers = [vote('u1', NOW, { deviceHash: 'dev-x', ip: '203.0.113.10' }), vote('u2', new Date(NOW.getTime() - SEC), { deviceHash: 'dev-x', ip: '203.0.113.10' }), vote('u3', new Date(NOW.getTime() - 2 * SEC), { deviceHash: 'dev-x', ip: '203.0.113.10' })];
  const verdict = evaluateRisk({
    userId: 'u3',
    ip: '203.0.113.10',
    deviceHash: 'dev-x',
    sameIpRecent: threeUsers,
    sameIpAll: threeUsers,
    sameDeviceAll: threeUsers,
    now: NOW,
  });
  assert.equal(verdict.score, 80);
  assert.equal(verdict.reasons.length, 3);

  // 叠加同 IP 高频(30) → 110 → 封顶 100
  const ipHigh = Array.from({ length: 5 }, (_, i) => vote(`h${i}`, new Date(NOW.getTime() - i * 5 * SEC), { ip: '203.0.113.10' }));
  const capped = evaluateRisk({
    userId: 'h9',
    ip: '203.0.113.10',
    deviceHash: 'dev-x',
    sameIpRecent: ipHigh,
    sameIpAll: [...threeUsers, ...ipHigh],
    sameDeviceAll: threeUsers,
    now: NOW,
  });
  assert.equal(capped.score, 100);
  assert.equal(capped.suspicious, true);
});
