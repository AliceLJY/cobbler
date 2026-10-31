import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseStatus, batchDate, daysBetween, listOutputBatches, pendingBatches, pickOutputBatch } from '../lib/output-pick.js';
import { runOutputCard, outputCardMain, formatOutputCardText, outputFollowupBody } from '../output-card.js';

const TODAY = '2026-10-31';

async function fixture(batches) {
  const root = await mkdtemp(join(tmpdir(), 'cobbler-output-'));
  for (const [dir, readme] of Object.entries(batches)) {
    await mkdir(join(root, dir), { recursive: true });
    if (readme !== null) await writeFile(join(root, dir, 'README.md'), readme);
  }
  return root;
}

test('parseStatus 认 **状态**、全角冒号、｜ 与 |，只取第一条', () => {
  assert.deepEqual(parseStatus('# x\n**状态**：等Alice ｜ 选一个方向往下挖\n状态: 已完成 | 别的'), { status: '等Alice', note: '选一个方向往下挖' });
  assert.deepEqual(parseStatus('状态: 已放弃 | 10-31 她说不做了'), { status: '已放弃', note: '10-31 她说不做了' });
  assert.deepEqual(parseStatus('状态: 可清'), { status: '可清', note: '' });
  assert.equal(parseStatus('这批是什么：等 Alice 选方向。'), null, '自然语言的「等 Alice」不算状态行');
  assert.equal(parseStatus('状态: 等她 | x'), null, '只认五个枚举值');
});

test('batchDate / daysBetween', () => {
  assert.equal(batchDate('2026-10-05-记忆系统跨域灵感地图'), '2026-10-05');
  assert.equal(batchDate('notes'), null);
  assert.equal(daysBetween('2026-10-05', TODAY), 26);
});

test('listOutputBatches 只收带状态行的批次，缺 README 或缺状态行的跳过不报错', async () => {
  const root = await fixture({
    '2026-10-05-a': '状态: 等Alice ｜ 选方向',
    '2026-10-15-b': '# 没状态行',
    '2026-10-20-c': null,
    'no-date': '状态: 等Alice ｜ 没日期前缀',
    '2026-10-29-d': '状态: 已完成 ｜ 做完了',
  });
  const got = await listOutputBatches(root);
  assert.deepEqual(got.map((b) => [b.dir, b.status]), [['2026-10-05-a', '等Alice'], ['2026-10-29-d', '已完成']]);
});

test('pendingBatches 只要 等Alice 且满 2 天', () => {
  const bs = [
    { dir: '2026-10-05-a', date: '2026-10-05', status: '等Alice', note: 'x' },
    { dir: '2026-10-30-b', date: '2026-10-30', status: '等Alice', note: 'y' },
    { dir: '2026-10-01-c', date: '2026-10-01', status: '已完成', note: '' },
  ];
  assert.deepEqual(pendingBatches(bs, TODAY).map((b) => b.dir), ['2026-10-05-a']);
});

test('pickOutputBatch 先抽没露过面的里最老的，全露过一轮再按上次露面最早的轮', () => {
  const bs = [
    { dir: '2026-10-05-a', date: '2026-10-05', status: '等Alice', note: 'x' },
    { dir: '2026-09-01-b', date: '2026-09-01', status: '等Alice', note: 'y' },
    { dir: '2026-10-20-c', date: '2026-10-20', status: '等Alice', note: 'z' },
  ];
  assert.equal(pickOutputBatch(bs, [], TODAY).dir, '2026-09-01-b');
  assert.equal(pickOutputBatch(bs, [{ dir: '2026-09-01-b', date: '2026-10-28' }], TODAY).dir, '2026-10-05-a');
  const all = [{ dir: '2026-09-01-b', date: '2026-10-27' }, { dir: '2026-10-05-a', date: '2026-10-28' }, { dir: '2026-10-20-c', date: '2026-10-29' }];
  assert.equal(pickOutputBatch(bs, all, TODAY).dir, '2026-09-01-b', '全抽过后挑上次露面最早的，不会连着重复昨天那张');
  assert.equal(pickOutputBatch([], [], TODAY), null);
});

test('formatOutputCardText 带批次名、在等什么、剩余数、可复制条子', () => {
  const card = { dir: '2026-10-05-a', date: '2026-10-05', note: '选一个方向往下挖' };
  const text = formatOutputCardText(card, TODAY, 3);
  assert.match(text, /产出回捞 · 10月31日/);
  assert.match(text, /26 天没人管了/);
  assert.match(text, /在等你：选一个方向往下挖/);
  assert.match(text, /池里还有 2 份/);
  assert.ok(text.endsWith(outputFollowupBody(card)), '条子在末尾，sendTelegramMessage 才能把它做成代码块');
  assert.match(outputFollowupBody(card), /AI产出\/2026-10-05-a\/README\.md/);
  assert.match(formatOutputCardText(card, TODAY, 1), /最后一份/);
});

test('runOutputCard dry-run 不发不写历史；正式跑发一条并写历史与卡片', async () => {
  const root = await fixture({ '2026-10-05-a': '状态: 等Alice ｜ 选方向' });
  const dataDir = await mkdtemp(join(tmpdir(), 'cobbler-output-data-'));
  await writeFile(join(dataDir, 'tg.json'), JSON.stringify({ token: 't', chatId: 'c' }));
  const sent = [];
  const sendImpl = async (m) => { sent.push(m); return { ok: true }; };
  const dry = await runOutputCard({ outputDir: root, dataDir, todayISO: TODAY, dryRun: true, sendImpl, log: () => {} });
  assert.equal(dry.delivered, 'dry-run');
  assert.equal(sent.length, 0);
  await assert.rejects(readFile(join(dataDir, 'output-history.json')), 'dry-run 不写历史');
  const real = await runOutputCard({ outputDir: root, dataDir, todayISO: TODAY, sendImpl, log: () => {} });
  assert.equal(real.delivered, 'tg');
  assert.equal(sent.length, 1);
  assert.ok(sent[0].text.endsWith(sent[0].preTail));
  const hist = JSON.parse(await readFile(join(dataDir, 'output-history.json'), 'utf8'));
  assert.deepEqual(hist, [{ dir: '2026-10-05-a', date: TODAY }]);
  const cardFile = JSON.parse(await readFile(join(dataDir, 'output-cards', `${TODAY}.json`), 'utf8'));
  assert.equal(cardFile.dir, '2026-10-05-a');
});

test('池子空：退出码 0、不发、不报警；tg.json 缺凭证：退出码 1 + 报警', async () => {
  const empty = await fixture({ '2026-10-30-fresh': '状态: 等Alice ｜ 还没满 2 天' });
  const dataDir = await mkdtemp(join(tmpdir(), 'cobbler-output-data-'));
  const notes = [];
  const sent = [];
  const c = await outputCardMain({ outputDir: empty, dataDir, todayISO: TODAY, sendImpl: async (m) => { sent.push(m); }, log: () => {} },
    { out: () => {}, err: () => {}, notify: async (t) => { notes.push(t); } });
  assert.equal(c.empty, true);
  assert.equal(sent.length, 0);
  assert.equal(notes.length, 0);
  assert.equal(process.exitCode ?? 0, 0);

  const root = await fixture({ '2026-10-05-a': '状态: 等Alice ｜ 选方向' });
  const bad = await outputCardMain({ outputDir: root, dataDir, todayISO: TODAY, sendImpl: async (m) => { sent.push(m); }, log: () => {} },
    { out: () => {}, err: () => {}, notify: async (t) => { notes.push(t); } });
  assert.equal(bad, null);
  assert.equal(process.exitCode, 1);
  assert.equal(sent.length, 0);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /产出回捞 08:20 失败@/);
  process.exitCode = 0;
});
