import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFrontmatter, extractSummary, parsePage, listHippoPages, pickHippoPage } from '../lib/hippo-pick.js';

const PAGE = `---
type: concept
title: "组合式创新靠广度感知"
updated: 2026-07-05
---

# 组合式创新靠广度感知

> [!summary]
> 组合式创新需要的是广度感知,
> 不是深度掌握。

## 论证
`;

test('parseFrontmatter 提取 title/type/updated,去引号', () => {
  const fm = parseFrontmatter(PAGE);
  assert.equal(fm.title, '组合式创新靠广度感知');
  assert.equal(fm.type, 'concept');
  assert.equal(fm.updated, '2026-07-05');
});

test('extractSummary 合并 summary callout 多行', () => {
  assert.equal(extractSummary(PAGE), '组合式创新需要的是广度感知, 不是深度掌握。');
});

test('extractSummary 无 callout 时取首个正文段', () => {
  const raw = `---\ntitle: X\n---\n\n# X\n\n| a | b |\n\n正文第一句。\n`;
  assert.equal(extractSummary(raw), '正文第一句。');
});

test('parsePage 无 frontmatter 用文件名当标题,type 来自目录映射', () => {
  const p = parsePage('> [!summary]\n> 一句话。\n', 'MediaPipe.md', 'entities');
  assert.equal(p.title, 'MediaPipe');
  assert.equal(p.type, 'entity');
  assert.equal(p.file, 'entities/MediaPipe.md');
  assert.equal(p.summary, '一句话。');
});

test('listHippoPages 扫三目录,排除 _index/CLAUDE.md', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hippo-'));
  try {
    await mkdir(join(dir, 'wiki', 'concepts'), { recursive: true });
    await mkdir(join(dir, 'wiki', 'entities'), { recursive: true });
    await writeFile(join(dir, 'wiki', 'concepts', 'A.md'), PAGE);
    await writeFile(join(dir, 'wiki', 'concepts', '_index.md'), '# index');
    await writeFile(join(dir, 'wiki', 'entities', 'CLAUDE.md'), '# stub');
    await writeFile(join(dir, 'wiki', 'entities', 'B.md'), '> [!summary]\n> B 摘要。\n');
    const pages = await listHippoPages(dir);
    assert.deepEqual(pages.map((p) => p.file).sort(), ['concepts/A.md', 'entities/B.md']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pickHippoPage 排除 history、跳过无摘要页;全抽过则回退全池', () => {
  const pages = [
    { file: 'a', summary: 's' },
    { file: 'b', summary: 's' },
    { file: 'c', summary: '' },
  ];
  const p = pickHippoPage(pages, ['a'], () => 0);
  assert.equal(p.file, 'b');
  const back = pickHippoPage(pages, ['a', 'b'], () => 0);
  assert.equal(back.file, 'a'); // 全在 history → 回退全池随机
  assert.equal(pickHippoPage([{ file: 'x', summary: '' }], []), null);
});
