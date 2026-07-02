import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackCard, fallbackMutter, fallbackDiary, truncate } from '../lib/templates.js';

test('fallbackCard 填充句式并限长', () => {
  const c = fallbackCard({ title: 'x'.repeat(60), detail: 'y'.repeat(200) }, '2 个月前的今天');
  assert.ok(c.cardTitle.startsWith('2 个月前的今天'));
  assert.ok(c.cardBody.length <= 100);
});

test('fallbackMutter 按心情出句且 ≤40 字', () => {
  for (const mood of ['calm', 'happy', 'sleepy', 'grumbly']) {
    const m = fallbackMutter(mood, () => 0);
    assert.ok(typeof m === 'string' && m.length > 0 && m.length <= 40, `${mood}: ${m}`);
  }
});

test('fallbackDiary 出句', () => {
  assert.ok(fallbackDiary(() => 0).length > 0);
});

test('truncate 截断加省略号', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
});
