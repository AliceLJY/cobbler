import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { listHippoPages, pickHippoPage } from './lib/hippo-pick.js';
import { generateHippoCard, fallbackHippoCard } from './lib/hippo-gen.js';
import { sendTelegramMessage, formatHippoCardText } from './lib/tg-send.js';
import { readJSON, writeJSONAtomic } from './lib/store.js';
import { localDateISO } from './lib/dates.js';

const pexec = promisify(execFile);
const HISTORY_LIMIT = 90;

export async function runHippoCard(cfg) {
  const { hippoDir, dataDir, personaPath, todayISO, rng = Math.random } = cfg;
  const gen = cfg.hippoGen ?? generateHippoCard;
  const send = cfg.sendImpl ?? sendTelegramMessage;
  const gitPull = cfg.gitPull ?? (() => pexec('git', ['-C', hippoDir, 'pull', '--ff-only', '--quiet'], { timeout: 30000 }));

  // 保鲜尽力而为:离线/冲突都不挡抽卡(repos-autopull 每 4h 另有兜底)
  try { await gitPull(); } catch { /* offline ok */ }

  const pages = await listHippoPages(hippoDir);
  if (!pages.length) throw new Error(`hippo-card: no pages under ${hippoDir}`);

  const historyFile = join(dataDir, 'hippo-history.json');
  const history = await readJSON(historyFile, []);
  const page = pickHippoPage(pages, history, rng);
  if (!page) throw new Error('hippo-card: nothing to pick');

  const persona = await readFile(personaPath, 'utf8');
  const g = (await gen({ persona, page })) ?? fallbackHippoCard(page, rng);

  const card = {
    date: todayISO,
    pageTitle: page.title,
    pageFile: page.file,
    pageType: page.type,
    title: g.cardTitle,
    body: g.cardBody,
    question: g.question,
    mutter: g.mutter,
    source: 'hippo',
  };
  await writeJSONAtomic(join(dataDir, 'hippo-cards', `${todayISO}.json`), card);
  await writeJSONAtomic(historyFile, [...history, page.file].slice(-HISTORY_LIMIT));

  const tg = await readJSON(join(dataDir, 'tg.json'), null);
  if (tg?.token && tg?.chatId) {
    await send({ token: tg.token, chatId: tg.chatId, text: formatHippoCardText(card, todayISO) });
    return { ...card, delivered: 'tg' };
  }
  return { ...card, delivered: 'none' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const HOME = process.env.HOME;
  const claudeBin = process.env.COBBLER_CLAUDE_BIN;
  runHippoCard({
    hippoDir: process.env.COBBLER_HIPPO_DIR ?? `${HOME}/Projects/河马项目/hippo-wiki`,
    dataDir: new URL('./data', import.meta.url).pathname,
    personaPath: new URL('./persona.md', import.meta.url).pathname,
    todayISO: localDateISO(),
    ...(claudeBin ? { hippoGen: (input) => generateHippoCard(input, { claudeBin }) } : {}),
  }).then(
    (c) => { console.log(`[cobbler-hippo] ok page="${c.pageTitle}" delivered=${c.delivered}`); },
    (e) => { console.error('[cobbler-hippo] fail', e); process.exitCode = 1; },
  );
}
