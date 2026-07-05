import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleUpdate, latestHippoCard } from '../tg-listener.js';

const CARD = { date: '2026-07-05', pageTitle: 'MediaPipe', pageFile: 'entities/MediaPipe.md', followups: ['F1', 'F2'], mutter: 'M' };

async function withDataDir(cards, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'hippo-listen-'));
  try {
    if (cards.length) {
      await mkdir(join(dir, 'hippo-cards'), { recursive: true });
      for (const c of cards) await writeFile(join(dir, 'hippo-cards', `${c.date}.json`), JSON.stringify(c));
    }
    await fn(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('latestHippoCard 取日期最新一张', async () => {
  await withDataDir([{ ...CARD, date: '2026-07-04', pageTitle: 'OLD' }, CARD], async (dir) => {
    const c = await latestHippoCard(dir);
    assert.equal(c.pageTitle, 'MediaPipe');
  });
});

test('本人消息 → 回条子(含路径与问题)', async () => {
  await withDataDir([CARD], async (dir) => {
    const r = await handleUpdate({ message: { text: '想深挖', chat: { id: 8315648213 } } }, { chatId: 8315648213, dataDir: dir });
    assert.ok(r.includes('entities/MediaPipe.md') && r.includes('1. F1'));
  });
});

test('陌生人 / 无文本 → 不理', async () => {
  await withDataDir([CARD], async (dir) => {
    assert.equal(await handleUpdate({ message: { text: 'hi', chat: { id: 999 } } }, { chatId: 8315648213, dataDir: dir }), null);
    assert.equal(await handleUpdate({ message: { chat: { id: 8315648213 } } }, { chatId: 8315648213, dataDir: dir }), null);
    assert.equal(await handleUpdate({}, { chatId: 8315648213, dataDir: dir }), null);
  });
});

test('还没有任何卡 → 回开张提示', async () => {
  await withDataDir([], async (dir) => {
    const r = await handleUpdate({ message: { text: 'hi', chat: { id: 1 } } }, { chatId: 1, dataDir: dir });
    assert.ok(r.includes('九点'));
  });
});
