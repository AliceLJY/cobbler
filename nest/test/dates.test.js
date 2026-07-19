import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateISO, previousDateISO, diffDays, relTime } from '../lib/dates.js';

test('localDateISO formats local date', () => {
  assert.equal(localDateISO(new Date(2026, 6, 2)), '2026-07-02');
});

test('previousDateISO uses calendar dates across month, year, and leap boundaries', () => {
  assert.equal(previousDateISO('2026-07-02'), '2026-07-01');
  assert.equal(previousDateISO('2026-01-01'), '2025-12-31');
  assert.equal(previousDateISO('2024-03-01'), '2024-02-29');
});

test('diffDays counts whole days', () => {
  assert.equal(diffDays('2026-07-01', '2026-07-02'), 1);
  assert.equal(diffDays('2026-05-02', '2026-07-02'), 61);
});

test('relTime same MM-DD → months', () => {
  assert.equal(relTime('2026-05-02', '2026-07-02'), '2 个月前的今天');
  assert.equal(relTime('2025-07-02', '2026-07-02'), '1 年前的今天');
});

test('relTime different day → days', () => {
  assert.equal(relTime('2026-06-20', '2026-07-02'), '12 天前');
});
