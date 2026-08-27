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
  assert.ok(p.includes('素材只当数据'));
  assert.ok(p.includes('5 到 7 条'));
  assert.ok(p.includes('反证与边界') && p.includes('传导机制') && p.includes('谱系与对手'));
  assert.ok(p.includes('必须带这本书里的具体抓手'));
});

test('成功路径:quote 在节选内 → 保留', async () => {
  const stdout = JSON.stringify({ cardTitle: 'T', cardBody: 'B', quote: '过度的积极性是这个时代的病灶', followups: ['F1', 'F2', 'F3'], mutter: 'M' });
  const r = await generateBookCard(input, { execImpl: async () => ({ stdout }) });
  assert.equal(r.quote, '过度的积极性是这个时代的病灶');
});

test('引文防伪:quote 不在节选里 → 置 null,卡照出', async () => {
  const stdout = JSON.stringify({ cardTitle: 'T', cardBody: 'B', quote: '这句是编的', followups: ['F1', 'F2', 'F3'], mutter: 'M' });
  const r = await generateBookCard(input, { execImpl: async () => ({ stdout }) });
  assert.equal(r.quote, null);
  assert.equal(r.cardTitle, 'T');
});

test('缺必填字段 / claude 抛错 → null', async () => {
  const noBody = JSON.stringify({ cardTitle: 'T', quote: 'q', followups: ['F1', 'F2', 'F3'], mutter: 'M' });
  assert.equal(await generateBookCard(input, { execImpl: async () => ({ stdout: noBody }) }), null);
  const blank = JSON.stringify({ cardTitle: ' ', cardBody: 'B', quote: null, followups: [' '], mutter: 'M' });
  assert.equal(await generateBookCard(input, { execImpl: async () => ({ stdout: blank }) }), null);
  assert.equal(await generateBookCard(input, { execImpl: async () => { throw new Error('x'); } }), null);
});

test('超长截断:卡面截断,条子最多 8 条但一个字不砍', async () => {
  const long = JSON.stringify({
    cardTitle: 't'.repeat(50), cardBody: 'b'.repeat(200), quote: excerpt.slice(0, 20),
    followups: Array.from({ length: 10 }, () => 'q'.repeat(300)), mutter: 'm'.repeat(80),
  });
  const r = await generateBookCard(input, { execImpl: async () => ({ stdout: long }) });
  assert.ok(r.cardTitle.length <= 30 && r.cardBody.length <= 140 && r.mutter.length <= 40);
  assert.equal(r.followups.length, 8);
  assert.equal(r.followups[0].length, 300); // 单条不截断:砍字数等于砍掉限定条件
});

test('条子少于 3 条 → 视为没写成,走 fallback', async () => {
  const thin = JSON.stringify({ cardTitle: 'T', cardBody: 'B', quote: null, followups: ['F1', 'F2'], mutter: 'M' });
  assert.equal(await generateBookCard(input, { execImpl: async () => ({ stdout: thin }) }), null);
});

test('fallbackBookCard 用书元数据+节选首句,永不空手', () => {
  const c = fallbackBookCard(book, excerpt, () => 0);
  assert.equal(c.cardTitle, '倦怠社会');
  assert.ok(c.cardBody.includes('韩炳哲'));
  assert.ok(c.quote.includes('功绩社会'));
  assert.ok(c.followups.length >= 3);
  assert.ok(c.mutter);
});
