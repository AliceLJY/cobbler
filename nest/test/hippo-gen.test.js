import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHippoPrompt, generateHippoCard, fallbackHippoCard } from '../lib/hippo-gen.js';

const page = { title: 'MediaPipe', type: 'entity', date: '2026-07-05', summary: 'Google 浏览器端 ML 感知库。' };
const input = { persona: 'P', page };

test('buildHippoPrompt 含页面标题、摘要、日期', () => {
  const p = buildHippoPrompt(input);
  assert.ok(p.includes('「MediaPipe」'));
  assert.ok(p.includes('Google 浏览器端 ML 感知库。'));
  assert.ok(p.includes('2026-07-05'));
  assert.ok(p.includes('question'));
});

test('成功路径:四字段齐 → 返回卡', async () => {
  const stdout = '噪 {"cardTitle":"T","cardBody":"B","question":"Q","mutter":"M"} 音';
  const r = await generateHippoCard(input, { execImpl: async () => ({ stdout }) });
  assert.deepEqual(r, { cardTitle: 'T', cardBody: 'B', question: 'Q', mutter: 'M' });
});

test('缺 question / 空字段 / claude 抛错 → null', async () => {
  const noQ = JSON.stringify({ cardTitle: 'T', cardBody: 'B', mutter: 'M' });
  assert.equal(await generateHippoCard(input, { execImpl: async () => ({ stdout: noQ }) }), null);
  const empty = JSON.stringify({ cardTitle: 'T', cardBody: '', question: 'Q', mutter: 'M' });
  assert.equal(await generateHippoCard(input, { execImpl: async () => ({ stdout: empty }) }), null);
  assert.equal(await generateHippoCard(input, { execImpl: async () => { throw new Error('x'); } }), null);
});

test('超长截断', async () => {
  const long = JSON.stringify({ cardTitle: 't'.repeat(50), cardBody: 'b'.repeat(200), question: 'q'.repeat(80), mutter: 'm'.repeat(80) });
  const r = await generateHippoCard(input, { execImpl: async () => ({ stdout: long }) });
  assert.ok(r.cardTitle.length <= 30 && r.cardBody.length <= 100 && r.question.length <= 40 && r.mutter.length <= 40);
});

test('fallbackHippoCard 用页面标题和摘要,永不空手', () => {
  const c = fallbackHippoCard(page, () => 0);
  assert.equal(c.cardTitle, 'MediaPipe');
  assert.equal(c.cardBody, 'Google 浏览器端 ML 感知库。');
  assert.ok(c.question && c.mutter);
});
