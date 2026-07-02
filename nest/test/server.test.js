import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.js';
import { writeState, writeCard } from '../lib/store.js';
import { localDateISO } from '../lib/dates.js';

const dataDir = await mkdtemp(join(tmpdir(), 'srv-'));
const server = createServer({ dataDir });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

test('GET /api/state: 无状态 404,有状态 200', async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 404);
  await writeState(dataDir, { name: 'Cobbler', mood: 'calm', mutter: 'm', diary: [], stats: {}, generatedAt: 'x' });
  const r = await fetch(`${base}/api/state`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mood, 'calm');
});

test('GET /api/card/today 与 /api/cards', async () => {
  assert.equal((await fetch(`${base}/api/card/today`)).status, 404);
  const today = localDateISO();
  await writeCard(dataDir, { date: today, title: 'T', body: 'B', source: 'learning', sourceDetail: 's', relTime: 'r' });
  await writeCard(dataDir, { date: '2026-01-01', title: 'OLD', body: 'B', source: 'learning', sourceDetail: 's', relTime: 'r' });
  assert.equal((await (await fetch(`${base}/api/card/today`)).json()).title, 'T');
  const cards = await (await fetch(`${base}/api/cards?limit=1`)).json();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, 'T'); // 倒序:今天在前
});

test('POST /api/heartbeat 落盘', async () => {
  const r = await fetch(`${base}/api/heartbeat`, { method: 'POST' });
  assert.deepEqual(await r.json(), { ok: true });
});

test('未知路由 404 JSON', async () => {
  const r = await fetch(`${base}/api/nope`);
  assert.equal(r.status, 404);
  assert.ok((await r.json()).error);
});
