import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWithClaude, buildPrompt } from '../lib/claude-gen.js';

const input = { persona: 'P', mood: 'calm', item: { title: 't', detail: 'd', date: '2026-05-02', kind: 'learning' }, relTimeStr: '2 个月前的今天', needDiary: false, daysAway: 0 };

test('成功路径:解析 claude 输出的 JSON', async () => {
  const execImpl = async () => ({ stdout: '前置噪音 {"cardTitle":"T","cardBody":"B","mutter":"M"} 后置' });
  const r = await generateWithClaude(input, { execImpl });
  assert.deepEqual(r, { cardTitle: 'T', cardBody: 'B', mutter: 'M' });
});

test('claude 抛错/超时 → null', async () => {
  const execImpl = async () => { throw new Error('timeout'); };
  assert.equal(await generateWithClaude(input, { execImpl }), null);
});

test('坏 JSON → null', async () => {
  const execImpl = async () => ({ stdout: 'not json at all' });
  assert.equal(await generateWithClaude(input, { execImpl }), null);
});

test('缺必填字段 → null;超长截断', async () => {
  const execImpl = async () => ({ stdout: JSON.stringify({ cardTitle: 'T' }) });
  assert.equal(await generateWithClaude(input, { execImpl }), null);
  const long = JSON.stringify({ cardTitle: 'T', cardBody: 'x'.repeat(300), mutter: 'y'.repeat(80) });
  const r = await generateWithClaude(input, { execImpl: async () => ({ stdout: long }) });
  assert.ok(r.cardBody.length <= 100 && r.mutter.length <= 40);
});

test('needDiary 时 prompt 提及日记且结果保留 diary', async () => {
  const p = buildPrompt({ ...input, needDiary: true, daysAway: 5 });
  assert.ok(p.includes('diary'));
  const execImpl = async () => ({ stdout: JSON.stringify({ cardTitle: 'T', cardBody: 'B', mutter: 'M', diary: 'D' }) });
  const r = await generateWithClaude({ ...input, needDiary: true }, { execImpl });
  assert.equal(r.diary, 'D');
});
