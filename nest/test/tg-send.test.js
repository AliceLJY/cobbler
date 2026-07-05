import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegramMessage, formatHippoCardText, formatFollowupText } from '../lib/tg-send.js';

const ok = { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
const bad = { ok: false, status: 502, json: async () => ({ ok: false, description: 'bad gateway' }) };

test('成功路径:一次发出', async () => {
  let calls = 0;
  const r = await sendTelegramMessage({ token: 't', chatId: 1, text: 'x' }, { fetchImpl: async () => { calls++; return ok; } });
  assert.equal(r.message_id, 1);
  assert.equal(calls, 1);
});

test('失败重试后成功', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls < 3 ? bad : ok);
  const r = await sendTelegramMessage({ token: 't', chatId: 1, text: 'x' }, { fetchImpl, baseDelayMs: 1 });
  assert.equal(calls, 3);
  assert.equal(r.message_id, 1);
});

test('重试耗尽 → throw;缺 token → throw', async () => {
  await assert.rejects(
    sendTelegramMessage({ token: 't', chatId: 1, text: 'x' }, { fetchImpl: async () => bad, retries: 2, baseDelayMs: 1 }),
    /not ok \(502\)/,
  );
  await assert.rejects(sendTelegramMessage({ token: '', chatId: 1, text: 'x' }), /missing token/);
});

test('formatHippoCardText 纯文本简介卡:无考题,带回我提示', () => {
  const text = formatHippoCardText(
    { pageTitle: 'MediaPipe', body: 'B', followups: ['F1', 'F2'], mutter: 'M' },
    '2026-07-05',
  );
  assert.ok(text.startsWith('🥚 知识扭蛋 · 7月5日'));
  assert.ok(text.includes('「MediaPipe」'));
  assert.ok(text.includes('—— M'));
  assert.ok(text.includes('回我一下'));
  assert.ok(!text.includes('F1')); // followups 不进卡片,回复才给
  assert.ok(!text.includes('*') && !text.includes('#'));
});

test('formatFollowupText 条子含页面路径和两个问题', () => {
  const text = formatFollowupText({ pageTitle: 'MediaPipe', pageFile: 'entities/MediaPipe.md', followups: ['F1', 'F2'] });
  assert.ok(text.includes('wiki/entities/MediaPipe.md'));
  assert.ok(text.includes('1. F1') && text.includes('2. F2'));
  assert.ok(text.includes('「MediaPipe」'));
});
