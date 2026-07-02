import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline } from '../generate.js';
import { appendHeartbeat, listCards } from '../lib/store.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nest-'));
  const learningsDir = join(root, 'learnings');
  const projectsDir = join(root, 'projects'); // 空:git 信号为零
  const dataDir = join(root, 'data');
  await mkdir(learningsDir); await mkdir(projectsDir); await mkdir(dataDir, { recursive: true });
  await writeFile(join(learningsDir, '2026-05.md'),
    '| 1 | 05-02 | 旧的折腾 | 那天的主题 | cat |\n');
  const personaPath = join(root, 'persona.md');
  await writeFile(personaPath, 'PERSONA');
  return { learningsDir, projectsDir, dataDir, personaPath };
}

test('管线:claude 成功路径,state+card 落盘', async () => {
  const f = await fixture();
  await appendHeartbeat(f.dataDir, '2026-07-01T08:00:00+08:00');
  const state = await runPipeline({
    ...f, todayISO: '2026-07-02', rng: () => 0,
    claudeGen: async () => ({ cardTitle: 'T', cardBody: 'B', mutter: 'M' }),
  });
  // 昨天有心跳(信号 1 天内、昨天有活动),无 commit/learnings 本周 → calm
  assert.equal(state.mood, 'calm');
  const card = JSON.parse(await readFile(join(f.dataDir, 'cards', '2026-07-02.json'), 'utf8'));
  assert.deepEqual(card, {
    date: '2026-07-02', title: 'T', body: 'B',
    source: 'learning', sourceDetail: '旧的折腾', relTime: '2 个月前的今天',
  });
  const st = JSON.parse(await readFile(join(f.dataDir, 'state.json'), 'utf8'));
  assert.equal(st.mutter, 'M');
});

test('管线:claude 失败走模板,不空手', async () => {
  const f = await fixture();
  const state = await runPipeline({
    ...f, todayISO: '2026-07-02', rng: () => 0, claudeGen: async () => null,
  });
  assert.ok(state.mutter.length > 0);
  const cards = await listCards(f.dataDir, 10);
  assert.equal(cards.length, 1);
  assert.ok(cards[0].title.includes('2 个月前的今天'));
});

test('管线:grumbly 追加日记且 cap 14', async () => {
  const f = await fixture();
  // 无 heartbeat、learnings 最新 05-02 → 距今 >4 天 → grumbly
  let state;
  for (let i = 0; i < 16; i++) {
    state = await runPipeline({ ...f, todayISO: '2026-07-02', rng: () => 0, claudeGen: async () => null });
  }
  assert.equal(state.mood, 'grumbly');
  assert.ok(state.diary.length <= 14);
  assert.equal(state.diary.at(-1).date, '2026-07-02');
});
