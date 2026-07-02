import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeMood } from '../lib/mood.js';

const base = { lastSignalISO: '2026-07-01', commits7d: 0, learningsThisWeek: false, lastHeartbeatISO: '2026-07-01', activityYesterday: true };
const T = '2026-07-02';

test('grumbly: ≥4 天无信号(含从无信号)', () => {
  assert.equal(judgeMood({ ...base, lastSignalISO: '2026-06-28' }, T), 'grumbly');
  assert.equal(judgeMood({ ...base, lastSignalISO: null }, T), 'grumbly');
});

test('grumbly 优先于 happy', () => {
  assert.equal(judgeMood({ ...base, lastSignalISO: '2026-06-27', commits7d: 9 }, T), 'grumbly');
});

test('happy: 活跃 + 3 天内心跳', () => {
  assert.equal(judgeMood({ ...base, commits7d: 5 }, T), 'happy');
  assert.equal(judgeMood({ ...base, learningsThisWeek: true }, T), 'happy');
});

test('happy 需要心跳: 无心跳不 happy', () => {
  assert.equal(judgeMood({ ...base, commits7d: 9, lastHeartbeatISO: null }, T), 'calm');
});

test('sleepy: 昨天零活动', () => {
  assert.equal(judgeMood({ ...base, activityYesterday: false }, T), 'sleepy');
});

test('calm: 默认', () => {
  assert.equal(judgeMood(base, T), 'calm');
});
