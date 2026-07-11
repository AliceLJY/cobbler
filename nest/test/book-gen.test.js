import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookPrompt, generateBookCard, fallbackBookCard } from '../lib/book-gen.js';

const book = { title: '倦怠社会', author: '韩炳哲', dir: 'd1' };
const excerpt = '功绩社会的主体对自身施暴。过度的积极性是这个时代的病灶,它比压迫更隐蔽。';
const input = { persona: 'P', book, excerpt };

test('buildBookPrompt 含书名、作者、节选、quote 一字不改要求', () => {
  const p = buildBookPrompt(input);
  assert.ok(p.includes('《倦怠社会》'));
  assert.ok(p.includes('韩炳哲'));
  assert.ok(p.includes('功绩社会的主体对自身施暴'));
  assert.ok(p.includes('一字不改'));
});

test('成功路径:quote 在节选内 → 保留', async () => {
  const stdout = JSON.stringify({ cardTitle: 'T', cardBody: 'B', quote: '过度的积极性是这个时代的病灶', followups: ['F1', 'F2'], mutter: 'M' });
  const r = await generateBookCard(input, { execImpl: async () => ({ stdout }) });
  assert.equal(r.quote, '过度的积极性是这个时代的病灶');
});

test('引文防伪:quote 不在节选里 → 置 null,卡照出', async () => {
  const stdout = JSON.stringify({ cardTitle: 'T', cardBody: 'B', quote: '这句是编的', followups: ['F1', 'F2'], mutter: 'M' });
  const r = await generateBookCard(input, { execImpl: async () => ({ stdout }) });
  assert.equal(r.quote, null);
  assert.equal(r.cardTitle, 'T');
});

test('缺必填字段 / claude 抛错 → null', async () => {
  const noBody = JSON.stringify({ cardTitle: 'T', quote: 'q', followups: ['F'], mutter: 'M' });
  assert.equal(await generateBookCard(input, { execImpl: async () => ({ stdout: noBody }) }), null);
  assert.equal(await generateBookCard(input, { execImpl: async () => { throw new Error('x'); } }), null);
});

test('超长截断', async () => {
  const long = JSON.stringify({ cardTitle: 't'.repeat(50), cardBody: 'b'.repeat(200), quote: excerpt.slice(0, 20), followups: ['q'.repeat(80), 'w'], mutter: 'm'.repeat(80) });
  const r = await generateBookCard(input, { execImpl: async () => ({ stdout: long }) });
  assert.ok(r.cardTitle.length <= 30 && r.cardBody.length <= 140 && r.mutter.length <= 40);
});

test('fallbackBookCard 用书元数据+节选首句,永不空手', () => {
  const c = fallbackBookCard(book, excerpt, () => 0);
  assert.equal(c.cardTitle, '倦怠社会');
  assert.ok(c.cardBody.includes('韩炳哲'));
  assert.ok(c.quote.includes('功绩社会'));
  assert.equal(c.followups.length, 2);
  assert.ok(c.mutter);
});
