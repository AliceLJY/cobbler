import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildHippoPrompt } from '../lib/hippo-gen.js';
import { buildBookPrompt } from '../lib/book-gen.js';

// 两条扭蛋 prompt 的整段快照(2026-09-19 加)。
// 缘由:hippo-gen / book-gen 的测试只断言十几个锚点短语,没被断言的行被哪次编辑「顺手精简」掉,
// 测试照样全绿——正是「派活 prompt 逐字转录、不许精简」那条纪律要防的失败,只是发生在改代码时。
// 有意改 prompt(或 persona.md)时跑:UPDATE_PROMPT_SNAPSHOT=1 npm test,改动会完整出现在 diff 里。
// 快照里只有模板和假素材,不含她的任何页面或书的内容(仓库是公开的)。

const SNAP_DIR = new URL('./__snapshots__/', import.meta.url);
const persona = readFileSync(new URL('../persona.md', import.meta.url), 'utf8');

function matchSnapshot(name, actual) {
  const file = new URL(name, SNAP_DIR);
  if (process.env.UPDATE_PROMPT_SNAPSHOT) {
    mkdirSync(SNAP_DIR, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  let expected;
  try { expected = readFileSync(file, 'utf8'); } catch {
    assert.fail(`缺快照 test/__snapshots__/${name}:跑 UPDATE_PROMPT_SNAPSHOT=1 npm test 生成`);
  }
  assert.equal(actual, expected, `${name} 与快照不一致。有意改 prompt 就跑 UPDATE_PROMPT_SNAPSHOT=1 npm test 重写快照`);
}

test('知识扭蛋 prompt 与快照逐字一致', () => {
  const page = {
    title: '示例页', type: 'source', date: '2026-07-24', revisited: 'never',
    summary: '示例摘要。', excerpt: '# 示例页\n\n示例正文第一段。',
  };
  matchSnapshot('hippo-prompt.txt', buildHippoPrompt({ persona, page }));
});

test('书堆扭蛋 prompt 与快照逐字一致', () => {
  const book = { title: '示例书', author: '示例作者', dir: 'd' };
  matchSnapshot('book-prompt.txt', buildBookPrompt({ persona, book, excerpt: '示例节选。' }));
});
