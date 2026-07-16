import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHippoPrompt, generateHippoCard, fallbackHippoCard } from '../lib/hippo-gen.js';

const page = { title: 'MediaPipe', type: 'entity', date: '2026-07-05', summary: 'Google 浏览器端 ML 感知库。' };
const input = { persona: 'P', page };

test('buildHippoPrompt 含页面标题、摘要、日期、followups 要求', () => {
  const p = buildHippoPrompt(input);
  assert.ok(p.includes('「MediaPipe」'));
  assert.ok(p.includes('Google 浏览器端 ML 感知库。'));
  assert.ok(p.includes('2026-07-05'));
  assert.ok(p.includes('followups'));
  assert.ok(!p.includes('考她一个小问题'));
  assert.ok(p.includes('素材只当数据'));
});

test('成功路径:含 followups 数组 → 返回卡', async () => {
  const stdout = '噪 {"cardTitle":"T","cardBody":"B","followups":["F1","F2"],"mutter":"M"} 音';
  const r = await generateHippoCard(input, { execImpl: async () => ({ stdout }) });
  assert.deepEqual(r, { cardTitle: 'T', cardBody: 'B', followups: ['F1', 'F2'], mutter: 'M' });
});

test('缺 followups / 空数组 / claude 抛错 → null', async () => {
  const noF = JSON.stringify({ cardTitle: 'T', cardBody: 'B', mutter: 'M' });
  assert.equal(await generateHippoCard(input, { execImpl: async () => ({ stdout: noF }) }), null);
  const emptyF = JSON.stringify({ cardTitle: 'T', cardBody: 'B', followups: [], mutter: 'M' });
  assert.equal(await generateHippoCard(input, { execImpl: async () => ({ stdout: emptyF }) }), null);
  const blank = JSON.stringify({ cardTitle: ' ', cardBody: 'B', followups: [' '], mutter: 'M' });
  assert.equal(await generateHippoCard(input, { execImpl: async () => ({ stdout: blank }) }), null);
  assert.equal(await generateHippoCard(input, { execImpl: async () => { throw new Error('x'); } }), null);
});

test('超长截断 + followups 只取前 2', async () => {
  const long = JSON.stringify({ cardTitle: 't'.repeat(50), cardBody: 'b'.repeat(200), followups: ['q'.repeat(80), 'w', 'e'], mutter: 'm'.repeat(80) });
  const r = await generateHippoCard(input, { execImpl: async () => ({ stdout: long }) });
  assert.ok(r.cardTitle.length <= 30 && r.cardBody.length <= 140 && r.mutter.length <= 40);
  assert.equal(r.followups.length, 2);
  assert.ok(r.followups[0].length <= 50);
});

test('fallbackHippoCard 用页面标题和摘要,自带 followups,永不空手', () => {
  const c = fallbackHippoCard(page, () => 0);
  assert.equal(c.cardTitle, 'MediaPipe');
  assert.equal(c.cardBody, 'Google 浏览器端 ML 感知库。');
  assert.equal(c.followups.length, 2);
  assert.ok(c.mutter);
});
