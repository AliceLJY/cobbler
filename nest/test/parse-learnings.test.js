import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLearningsFile, loadLearnings } from '../lib/parse-learnings.js';

const SAMPLE = `# 2026-06 学习归档

## 打卡表

| # | 日期 | 来源 | 主题 | 分类 |
|---|------|------|------|------|
| 1 | 06-01 | helloianneo/ian-xiaohei-illustrations | 配图 prompt 的风格内容分离架构 | borrow-audit / illustration-prompt |
| 2 | 06-13 | Panniantong/Agent-Reach(GitHub,26.8k★)| 值得借"联网能力层"结构 | borrow-audit / net |
`;

test('parseLearningsFile extracts rows', () => {
  const items = parseLearningsFile(SAMPLE, 2026);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    date: '2026-06-01',
    kind: 'learning',
    title: 'helloianneo/ian-xiaohei-illustrations',
    detail: '配图 prompt 的风格内容分离架构',
  });
});

test('parseLearningsFile skips header/divider rows', () => {
  assert.equal(parseLearningsFile('| # | 日期 |\n|---|---|', 2026).length, 0);
});

test('loadLearnings scans YYYY-MM.md files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'learn-'));
  await writeFile(join(dir, '2026-06.md'), SAMPLE);
  await writeFile(join(dir, 'notes.md'), '| 9 | 01-01 | x | y | z |');
  const items = await loadLearnings(dir);
  assert.equal(items.length, 2);
  assert.equal(items[0].date.slice(0, 4), '2026');
});
