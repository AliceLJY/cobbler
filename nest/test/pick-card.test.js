import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCard } from '../lib/pick-card.js';

const T = '2026-07-02';
const mk = (date, title) => ({ date, kind: 'learning', title, detail: '' });

test('DD 同日最旧优先("每月的今天")', () => {
  const items = [mk('2026-05-02', 'may'), mk('2026-04-02', 'april'), mk('2026-06-20', 'other')];
  assert.equal(pickCard(items, T).title, 'april');
});

test('同日排除今天本身', () => {
  const items = [mk('2026-07-02', 'today'), mk('2026-05-15', 'old')];
  assert.equal(pickCard(items, T).title, 'old');
});

test('无同日 → 随机挑 >30 天前(rng 注入)', () => {
  const items = [mk('2026-06-25', 'too-new'), mk('2026-05-15', 'a'), mk('2026-04-10', 'b')];
  assert.equal(pickCard(items, T, () => 0).title, 'a');
  assert.equal(pickCard(items, T, () => 0.99).title, 'b');
});

test('素材空/全太新 → null', () => {
  assert.equal(pickCard([], T), null);
  assert.equal(pickCard([mk('2026-06-25', 'x')], T), null);
});
