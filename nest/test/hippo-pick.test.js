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

test('parsePage 的 date 取 created 而非 updated:复核过的老页不能被说成新研究的', () => {
  // prompt 里这个值会被拼成「她 X 前后研究过」。Temporal Reasoning 页 2026-09-10 复核后
  // updated 变成复核日,若优先取 updated 就等于告诉模型「她 9 月研究的」——是假话。
  const raw = '---\ntitle: "Temporal Reasoning"\ntype: concept\ncreated: 2026-04-13\nupdated: 2026-09-10\n---\n\n正文。\n';
  assert.equal(parsePage(raw, 'Temporal Reasoning.md', 'concepts').date, '2026-04-13');
  // 只有 updated 时仍要兜住,不能返回 null
  const onlyUpdated = '---\ntitle: "X"\nupdated: 2026-05-01\n---\n\n正文。\n';
  assert.equal(parsePage(onlyUpdated, 'X.md', 'concepts').date, '2026-05-01');
  // 两个都没有 → null(hippo-gen 据此省掉「前后研究过」那句)
  assert.equal(parsePage('正文。\n', 'Y.md', 'concepts').date, null);
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

// ---- revisited 三态（2026-09-14 加）----
// 缘由：09-13 扭蛋抽中 2026-04 建的「Garry Tan」页，卡片照四月记录讲得笃定，
// 而那页描述的对象早已面目全非。卡片当时无从知道这页有没有被回访过。

test('parsePage: created===updated → revisited=never', () => {
  const raw = `---\ntitle: X\ncreated: 2026-04-13\nupdated: 2026-04-13\n---\n\n正文。\n`;
  assert.equal(parsePage(raw, 'X.md', 'entities').revisited, 'never');
});

test('parsePage: updated 晚于 created → revisited=该日期', () => {
  const raw = `---\ntitle: X\ncreated: 2026-04-13\nupdated: 2026-09-13\n---\n\n正文。\n`;
  assert.equal(parsePage(raw, 'X.md', 'entities').revisited, '2026-09-13');
});

test('parsePage: 缺 created 或 updated → revisited=null，不得塌成 never', () => {
  const onlyCreated = `---\ntitle: X\ncreated: 2026-04-13\n---\n\n正文。\n`;
  const onlyUpdated = `---\ntitle: X\nupdated: 2026-04-13\n---\n\n正文。\n`;
  const neither = `---\ntitle: X\n---\n\n正文。\n`;
  for (const raw of [onlyCreated, onlyUpdated, neither]) {
    const p = parsePage(raw, 'X.md', 'entities');
    assert.equal(p.revisited, null, '缺字段必须是 null');
    assert.notEqual(p.revisited, 'never', '判不了 ≠ 没回访过');
  }
});
