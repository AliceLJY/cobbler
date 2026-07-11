import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listBooks, pickBook, pickExcerpt, pickBookExcerpt } from '../lib/book-pick.js';

async function makeLibrary(books) {
  const root = await mkdtemp(join(tmpdir(), 'book-pick-'));
  for (const b of books) {
    await mkdir(join(root, b.dir), { recursive: true });
    if (b.meta !== null) await writeFile(join(root, b.dir, 'metadata.json'), JSON.stringify(b.meta ?? { title: b.dir }));
    if (b.full !== null) await writeFile(join(root, b.dir, 'FULL.md'), b.full ?? 'x'.repeat(6000));
  }
  return root;
}

test('listBooks 收有 metadata+FULL.md 的书,跳过残次目录', async () => {
  const root = await makeLibrary([
    { dir: 'good', meta: { title: '倦怠社会', author: '韩炳哲' } },
    { dir: 'no-meta', meta: null },
    { dir: 'no-full', meta: { title: 'X' }, full: null },
    { dir: 'tiny-full', meta: { title: 'Y' }, full: 'short' },
  ]);
  try {
    const books = await listBooks(root);
    assert.equal(books.length, 1);
    assert.equal(books[0].title, '倦怠社会');
    assert.equal(books[0].author, '韩炳哲');
    assert.equal(books[0].dir, 'good');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('pickBook 按 dir 去重,全撞历史放开重复', () => {
  const books = [{ dir: 'a' }, { dir: 'b' }];
  assert.equal(pickBook(books, ['a'], () => 0).dir, 'b');
  assert.equal(pickBook([{ dir: 'a' }], ['a'], () => 0).dir, 'a');
  assert.equal(pickBook([], [], () => 0), null);
});

test('pickExcerpt 短文全给,长文取中段窗口且不超长', () => {
  assert.equal(pickExcerpt('短文', () => 0.5), '短文');
  // 每个词唯一,indexOf 才能可靠定位窗口起点(重复字符会处处匹配)
  const full = Array.from({ length: 30000 }, (_, i) => `w${i}`).join(' ');
  const ex = pickExcerpt(full, () => 0.5, { windowSize: 8000 });
  assert.ok(ex.length <= 8000);
  const start = full.indexOf(ex);
  assert.ok(start >= Math.floor(full.length * 0.15) && start <= Math.floor(full.length * 0.9));
});

test('pickExcerpt 对齐到就近段落边界', () => {
  const full = 'x'.repeat(30000) + '\n\n段落开头' + 'y'.repeat(60000);
  const ex = pickExcerpt(full, () => 0.3, { windowSize: 5000 });
  assert.ok(ex.startsWith('段落开头') || !ex.includes('\n\n段落开头'));
});

test('pickBookExcerpt 组合流:抽书+抽节选;空库 throw', async () => {
  const root = await makeLibrary([{ dir: 'solo', meta: { title: 'S' }, full: '正文。'.repeat(3000) }]);
  try {
    const { book, excerpt } = await pickBookExcerpt({ ebooksRoot: root, rng: () => 0.5 });
    assert.equal(book.title, 'S');
    assert.ok(excerpt.length > 100);
  } finally { await rm(root, { recursive: true, force: true }); }
  const empty = await mkdtemp(join(tmpdir(), 'book-empty-'));
  try {
    await assert.rejects(pickBookExcerpt({ ebooksRoot: empty }), /no books/);
  } finally { await rm(empty, { recursive: true, force: true }); }
});
