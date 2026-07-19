import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, writeJSONAtomic } from './lib/store.js';
import { sendTelegramMessage, formatFollowupText, formatMuseumFollowupText, formatBookFollowupText } from './lib/tg-send.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function latestIn(dataDir, sub) {
  let names = [];
  try { names = await readdir(join(dataDir, sub)); } catch { return null; }
  const latest = names.filter((n) => n.endsWith('.json')).sort().pop();
  if (!latest) return null;
  const file = join(dataDir, sub, latest);
  let mtimeMs = 0;
  try { mtimeMs = (await stat(file)).mtimeMs; } catch { /* keep 0 */ }
  return { file, date: latest.replace(/\.json$/, ''), mtimeMs };
}

export async function latestHippoCard(dataDir) {
  const hit = await latestIn(dataDir, 'hippo-cards');
  return hit ? readJSON(hit.file, null) : null;
}

// 扭蛋管线里取"最新投喂"的一张:先比日期,同日比 mtime(museum 08:30 → book 12:30 → hippo 21:00)
const CARD_DIRS = ['hippo-cards', 'museum-cards', 'book-cards'];

export async function latestCard(dataDir) {
  const cands = (await Promise.all(CARD_DIRS.map((d) => latestIn(dataDir, d)))).filter(Boolean);
  if (!cands.length) return null;
  cands.sort((a, b) => (a.date === b.date ? a.mtimeMs - b.mtimeMs : a.date < b.date ? -1 : 1));
  return readJSON(cands[cands.length - 1].file, null);
}

const FOLLOWUP_FORMATTERS = { museum: formatMuseumFollowupText, book: formatBookFollowupText };

// 纯逻辑:一条 update 进来,决定回什么(null = 不理)
export async function handleUpdate(update, { chatId, dataDir }) {
  const msg = update?.message;
  const incomingChatId = msg?.chat?.id;
  if (!msg?.text || incomingChatId == null || chatId == null || String(incomingChatId) !== String(chatId)) return null;
  const card = await latestCard(dataDir);
  if (!card) return '今晚还没开张。九点,老位置。';
  return (FOLLOWUP_FORMATTERS[card.source] ?? formatFollowupText)(card);
}

export async function pollLoop(cfg) {
  const { dataDir, fetchImpl = fetch, sendImpl = sendTelegramMessage, log = console.log } = cfg;
  const offsetFile = join(dataDir, 'tg-offset.json');

  for (;;) {
    const tg = await readJSON(join(dataDir, 'tg.json'), null);
    if (!tg?.token || !tg?.chatId) { log('[hippo-listen] no tg.json, retry in 60s'); await sleep(60000); continue; }

    let updates;
    try {
      const { offset = 0 } = await readJSON(offsetFile, {});
      const res = await fetchImpl(
        `https://api.telegram.org/bot${tg.token}/getUpdates?timeout=50&offset=${offset}`,
        { signal: AbortSignal.timeout(65000) },
      );
      const body = await res.json();
      if (!body.ok) throw new Error(`getUpdates not ok: ${body.description ?? res.status}`);
      updates = body.result;
    } catch (e) { log(`[hippo-listen] poll error: ${e.message ?? e}, retry in 5s`); await sleep(5000); continue; }

    let failed = false;
    for (const u of updates) {
      try {
        const reply = await handleUpdate(u, { chatId: tg.chatId, dataDir });
        if (reply) {
          await sendImpl({ token: tg.token, chatId: tg.chatId, text: reply });
          log(`[hippo-listen] replied to update ${u.update_id}`);
        }
      } catch (e) {
        log(`[hippo-listen] handle error on ${u.update_id}: ${e.message ?? e}; offset unchanged`);
        failed = true;
        break;
      }
      await writeJSONAtomic(offsetFile, { offset: u.update_id + 1 });
    }
    if (cfg.once) return;
    if (failed) await sleep(5000);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = new URL('./data', import.meta.url).pathname;
  console.log('[hippo-listen] up');
  pollLoop({ dataDir }).catch((e) => { console.error('[hippo-listen] fatal', e); process.exit(1); });
}
