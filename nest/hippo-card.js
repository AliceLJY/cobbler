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
import { notifyFailure, shortHostname, firstLine } from './lib/notify-fail.js';

const pexec = promisify(execFile);
const HISTORY_LIMIT = 90;

export async function runHippoCard(cfg) {
  const { hippoDir, dataDir, personaPath, todayISO, rng = Math.random } = cfg;
  // log 提到 gen 之前:gen 的默认实现要把降级原因写进同一份日志
  const log = cfg.log ?? console.error;
  const gen = cfg.hippoGen ?? ((input) => generateHippoCard(input, { onFail: log, onNote: log }));
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
  let g = await gen({ persona, page });
  // FALLBACK = 重试后仍没写成;怎么读它前面那 1~2 行原因,见 book-card.js 同处注释。
  if (!g) { log('[cobbler-hippo] FALLBACK 模型没出条子,降级到通用问题'); g = fallbackHippoCard(page, rng); }

  const card = {
    date: todayISO,
    pageTitle: page.title,
    pageFile: page.file,
    pageType: page.type,
    title: g.cardTitle,
    body: g.cardBody,
    followups: g.followups,
    mutter: g.mutter,
    source: 'hippo',
    ...(g.fallback ? { fallback: true } : {}),
  };
  await writeJSONAtomic(join(dataDir, 'hippo-cards', `${todayISO}.json`), card);
  await writeJSONAtomic(historyFile, [...history, page.file].slice(-HISTORY_LIMIT));

  // 凭证坏了不能算成功(2026-09-17 改):此前 tg.json 读不到或缺 token/chatId 会静默 delivered=none、退出码 0。
  // 卡片已写进 data/hippo-cards,抛错走 hippoCardMain 的失败出口(退出码 1 + TG 报警)。
  const tg = await readJSON(join(dataDir, 'tg.json'), null);
  if (!tg?.token || !tg?.chatId) throw new Error('tg.json 缺 token/chatId，卡片已写 data/hippo-cards 未送达');
  await send({ token: tg.token, chatId: tg.chatId, text: formatHippoCardText(card, todayISO) });
  return { ...card, delivered: 'tg' };
}

// 命令行入口的成败出口(2026-09-17 加),写法与理由见 book-card.js 同处注释。
export async function hippoCardMain(cfg, io = {}) {
  const out = io.out ?? console.log;
  const err = io.err ?? console.error;
  const notify = io.notify ?? notifyFailure;
  try {
    const c = await runHippoCard(cfg);
    out(`[cobbler-hippo] ${new Date().toISOString()} ok page="${c.pageTitle}" delivered=${c.delivered}`);
    return c;
  } catch (e) {
    err(`[cobbler-hippo] ${new Date().toISOString()} fail`, e);
    process.exitCode = 1;
    await notify(`知识扭蛋 21:00 失败@${shortHostname()}：${firstLine(e)}；日志 ~/Projects/cobbler/nest/data/hippo.log`, { log: err });
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const HOME = process.env.HOME;
  const claudeBin = process.env.COBBLER_CLAUDE_BIN;
  hippoCardMain({
    hippoDir: process.env.COBBLER_HIPPO_DIR ?? `${HOME}/knowledge-vault`,
    dataDir: new URL('./data', import.meta.url).pathname,
    personaPath: new URL('./persona.md', import.meta.url).pathname,
    todayISO: localDateISO(),
    ...(claudeBin ? { hippoGen: (input) => generateHippoCard(input, { claudeBin }) } : {}),
  });
}
