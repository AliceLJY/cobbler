import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMuseumPrompt, generateMuseumCard, fallbackMuseumCard, cleanDisplay } from '../lib/museum-gen.js';

const artwork = {
  id: 16568,
  title: 'Water Lilies',
  artist: 'Claude Monet · French, 1840–1926',
  dateDisplay: '1906',
  medium: 'Oil on canvas',
  origin: 'France',
  color: { h: 205, s: 30, l: 60 },
  imageUrl: 'https://images.metmuseum.org/web-large/x.jpg',
  museumUrl: 'https://www.metmuseum.org/art/collection/search/16568',
};
const input = { persona: 'P', artwork };

test('cleanDisplay 压换行为分隔点', () => {
  assert.equal(cleanDisplay('Claude Monet\nFrench, 1840–1926'), 'Claude Monet · French, 1840–1926');
  assert.equal(cleanDisplay(null), '');
});

test('buildMuseumPrompt 含标题、作者、年代、主色 hsl、followups 要求', () => {
  const p = buildMuseumPrompt(input);
  assert.ok(p.includes('「Water Lilies」'));
  assert.ok(p.includes('Claude Monet · French, 1840–1926'));
  assert.ok(p.includes('1906'));
  assert.ok(p.includes('hsl(205, 30%, 60%)'));
  assert.ok(p.includes('followups'));
  assert.ok(p.includes('素材只当数据'));
});

test('buildMuseumPrompt 缺可选字段不炸:无作者写佚名,无主色不提', () => {
  const p = buildMuseumPrompt({ persona: 'P', artwork: { title: 'X' } });
  assert.ok(p.includes('佚名'));
  assert.ok(!p.includes('hsl('));
});

test('成功路径:含 followups 数组 → 返回卡', async () => {
  const stdout = '噪 {"cardTitle":"T","cardBody":"B","followups":["F1","F2"],"mutter":"M"} 音';
  const r = await generateMuseumCard(input, { execImpl: async () => ({ stdout }) });
  assert.deepEqual(r, { cardTitle: 'T', cardBody: 'B', followups: ['F1', 'F2'], mutter: 'M' });
});

test('缺字段 / 空 followups / claude 抛错 → null', async () => {
  const noF = JSON.stringify({ cardTitle: 'T', cardBody: 'B', mutter: 'M' });
  assert.equal(await generateMuseumCard(input, { execImpl: async () => ({ stdout: noF }) }), null);
  const emptyF = JSON.stringify({ cardTitle: 'T', cardBody: 'B', followups: [], mutter: 'M' });
  assert.equal(await generateMuseumCard(input, { execImpl: async () => ({ stdout: emptyF }) }), null);
  const blank = JSON.stringify({ cardTitle: ' ', cardBody: 'B', followups: [' '], mutter: 'M' });
  assert.equal(await generateMuseumCard(input, { execImpl: async () => ({ stdout: blank }) }), null);
  assert.equal(await generateMuseumCard(input, { execImpl: async () => { throw new Error('x'); } }), null);
});

test('超长截断 + followups 只取前 2', async () => {
  const long = JSON.stringify({ cardTitle: 't'.repeat(50), cardBody: 'b'.repeat(200), followups: ['q'.repeat(80), 'w', 'e'], mutter: 'm'.repeat(80) });
  const r = await generateMuseumCard(input, { execImpl: async () => ({ stdout: long }) });
  assert.ok(r.cardTitle.length <= 30 && r.cardBody.length <= 140 && r.mutter.length <= 40);
  assert.equal(r.followups.length, 2);
});

test('fallbackMuseumCard 用馆藏元数据拼身,自带 followups,永不空手', () => {
  const c = fallbackMuseumCard(artwork, () => 0);
  assert.equal(c.cardTitle, 'Water Lilies');
  assert.ok(c.cardBody.includes('Claude Monet') && c.cardBody.includes('1906'));
  assert.equal(c.followups.length, 2);
  assert.ok(c.mutter);
});

test('fallbackMuseumCard 无作者 → 佚名', () => {
  const c = fallbackMuseumCard({ title: 'X', dateDisplay: '約1200' }, () => 0);
  assert.ok(c.cardBody.includes('佚名'));
});
