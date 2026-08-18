/**
 * 单测：活动状态机 computeStatus（P1 活动模块）。
 *
 * 纯函数测试，不碰 DB —— 验证懒计算规则：
 *   - collecting 到 collectEndAt / voteStartAt 自动 → voting
 *   - voting 到 voteEndAt 自动 → ended
 *   - draft / ended 不自动推进
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeStatus } from '../../src/lib/campaign-service';
import { CAMPAIGN_STATUS } from '../../src/lib/constants';

/** 构造最小活动行。 */
function row(overrides: {
  status: string;
  collectEndAt?: Date | null;
  voteStartAt?: Date | null;
  voteEndAt?: Date | null;
}) {
  return {
    status: overrides.status,
    collectEndAt: overrides.collectEndAt ?? null,
    voteStartAt: overrides.voteStartAt ?? null,
    voteEndAt: overrides.voteEndAt ?? null,
  };
}

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-08-01T00:00:00.000Z');

test('stored=collecting 且未到截止 → collecting', () => {
  const c = row({
    status: CAMPAIGN_STATUS.COLLECTING,
    collectEndAt: new Date(now.getTime() + 2 * HOUR),
    voteStartAt: new Date(now.getTime() + 2 * HOUR),
    voteEndAt: new Date(now.getTime() + 72 * HOUR),
  });
  assert.equal(computeStatus(c, now), CAMPAIGN_STATUS.COLLECTING);
});

test('stored=collecting 且已过 collectEndAt/voteStartAt → voting（自动开投）', () => {
  const c = row({
    status: CAMPAIGN_STATUS.COLLECTING,
    collectEndAt: new Date(now.getTime() - 1 * HOUR),
    voteStartAt: new Date(now.getTime() - 1 * HOUR),
    voteEndAt: new Date(now.getTime() + 72 * HOUR),
  });
  assert.equal(computeStatus(c, now), CAMPAIGN_STATUS.VOTING);
});

test('stored=collecting 且 voteStartAt 为空 → 视为 = collectEndAt', () => {
  const past = new Date(now.getTime() - 1 * HOUR);
  const c = row({
    status: CAMPAIGN_STATUS.COLLECTING,
    collectEndAt: past,
    voteStartAt: null,
    voteEndAt: new Date(now.getTime() + 72 * HOUR),
  });
  assert.equal(computeStatus(c, now), CAMPAIGN_STATUS.VOTING);
});

test('stored=collecting 但 collectEndAt 为空 → 保持 collecting', () => {
  const c = row({ status: CAMPAIGN_STATUS.COLLECTING, collectEndAt: null, voteStartAt: null, voteEndAt: null });
  assert.equal(computeStatus(c, now), CAMPAIGN_STATUS.COLLECTING);
});

test('stored=voting 且未到 voteEndAt → voting', () => {
  const c = row({
    status: CAMPAIGN_STATUS.VOTING,
    collectEndAt: new Date(now.getTime() - 24 * HOUR),
    voteStartAt: new Date(now.getTime() - 24 * HOUR),
    voteEndAt: new Date(now.getTime() + 24 * HOUR),
  });
  assert.equal(computeStatus(c, now), CAMPAIGN_STATUS.VOTING);
});

test('stored=voting 且已到 voteEndAt → ended（自动结束）', () => {
  const c = row({
    status: CAMPAIGN_STATUS.VOTING,
    collectEndAt: new Date(now.getTime() - 48 * HOUR),
    voteStartAt: new Date(now.getTime() - 48 * HOUR),
    voteEndAt: new Date(now.getTime() - 1 * HOUR),
  });
  assert.equal(computeStatus(c, now), CAMPAIGN_STATUS.ENDED);
});

test('stored=ended → 恒 ended（终态不自动复活）', () => {
  const c = row({
    status: CAMPAIGN_STATUS.ENDED,
    collectEndAt: new Date(now.getTime() - 48 * HOUR),
    voteStartAt: new Date(now.getTime() - 48 * HOUR),
    voteEndAt: new Date(now.getTime() - 1 * HOUR),
  });
  assert.equal(computeStatus(c, now), CAMPAIGN_STATUS.ENDED);
});

test('stored=draft → 恒 draft（不自动推进）', () => {
  const c = row({
    status: CAMPAIGN_STATUS.DRAFT,
    collectEndAt: new Date(now.getTime() - 48 * HOUR),
    voteStartAt: new Date(now.getTime() - 48 * HOUR),
    voteEndAt: new Date(now.getTime() - 1 * HOUR),
  });
  assert.equal(computeStatus(c, now), CAMPAIGN_STATUS.DRAFT);
});
