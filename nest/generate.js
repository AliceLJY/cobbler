import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { collect } from './collect.js';
import { judgeMood } from './lib/mood.js';
import { pickCard } from './lib/pick-card.js';
import { relTime, localDateISO, diffDays } from './lib/dates.js';
import { fallbackCard, fallbackMutter, fallbackDiary } from './lib/templates.js';
import { generateWithClaude } from './lib/claude-gen.js';
import { readState, writeState, writeCard } from './lib/store.js';

export async function runPipeline(cfg) {
  const { dataDir, personaPath, todayISO, rng = Math.random } = cfg;
  const claudeGen = cfg.claudeGen ?? generateWithClaude;

  const { items, signals } = await collect(cfg);
  const mood = judgeMood(signals, todayISO);
  const picked = pickCard(items, todayISO, rng);
  const relTimeStr = picked ? relTime(picked.date, todayISO) : null;
  const persona = await readFile(personaPath, 'utf8');
  const needDiary = mood === 'grumbly';
  const daysAway = signals.lastSignalISO ? diffDays(signals.lastSignalISO, todayISO) : 99;

  const gen = await claudeGen({ persona, mood, item: picked, relTimeStr, needDiary, daysAway });

  let card = null;
  if (picked) {
    const fc = gen?.cardTitle ? { cardTitle: gen.cardTitle, cardBody: gen.cardBody } : fallbackCard(picked, relTimeStr);
    card = {
      date: todayISO, title: fc.cardTitle, body: fc.cardBody,
      source: picked.kind, sourceDetail: picked.title, relTime: relTimeStr,
    };
    await writeCard(dataDir, card);
  }

  const prev = (await readState(dataDir)) ?? { diary: [] };
  const diary = [...(prev.diary ?? [])];
  if (needDiary) {
    diary.push({ date: todayISO, text: gen?.diary ?? fallbackDiary(rng) });
    while (diary.length > 14) diary.shift();
  }

  const state = {
    name: 'Cobbler',
    mood,
    mutter: gen?.mutter ?? fallbackMutter(mood, rng),
    diary,
    stats: {
      commits7d: signals.commits7d,
      learningsUpdated: signals.learningsThisWeek,
      lastSeen: signals.lastHeartbeatISO,
    },
    generatedAt: new Date().toISOString(),
  };
  await writeState(dataDir, state);
  return state;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const HOME = process.env.HOME;
  const claudeBin = process.env.COBBLER_CLAUDE_BIN; // 兜底演练用:指向不存在路径可模拟 claude 不可用
  runPipeline({
    learningsDir: `${HOME}/Downloads/sync-bridge/cc-memory/learnings`,
    projectsDir: `${HOME}/Projects`,
    dataDir: new URL('./data', import.meta.url).pathname,
    personaPath: new URL('./persona.md', import.meta.url).pathname,
    todayISO: localDateISO(),
    ...(claudeBin ? { claudeGen: (input) => generateWithClaude(input, { claudeBin }) } : {}),
  }).then(
    (s) => { console.log(`[cobbler-nest] ok mood=${s.mood}`); },
    (e) => { console.error('[cobbler-nest] fail', e); process.exitCode = 1; },
  );
}
