import { appendFile, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, writeJSONAtomic } from './lib/store.js';
import { sendTelegramMessage, answerCallback, editMessage, formatFollowupText, formatBookFollowupText } from './lib/tg-send.js';
import { handleCallback, settleDecisions, isPermanentTelegramError } from './lib/decision-flow.js';
// 2026-10-20：launchd 日志没有时间戳，看不出 poll 失败 / 自退重连发生在几点；统一给 console 加 ISO 时间前缀
for (const k of ['log', 'error', 'warn']) {
  const orig = console[k].bind(console);
  console[k] = (...args) => orig(new Date().toISOString(), ...args);
}

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

// 扭蛋管线里取"最新投喂"的一张:先比日期,同日比 mtime(book 07:40 → hippo 08:00；10-17 前是 12:30 → 21:00)
const CARD_DIRS = ['hippo-cards', 'book-cards'];

export async function latestCard(dataDir) {
  const cands = (await Promise.all(CARD_DIRS.map((d) => latestIn(dataDir, d)))).filter(Boolean);
  if (!cands.length) return null;
  cands.sort((a, b) => (a.date === b.date ? a.mtimeMs - b.mtimeMs : a.date < b.date ? -1 : 1));
  return readJSON(cands[cands.length - 1].file, null);
}

const FOLLOWUP_FORMATTERS = { book: formatBookFollowupText };

async function recordDeadLetter(dataDir, update, error) {
  const entry = {
    updateId: update.update_id,
    failedAt: new Date().toISOString(),
    error: String(error?.message ?? error),
  };
  await appendFile(join(dataDir, 'tg-dead-letter.jsonl'), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

// 纯逻辑:一条 update 进来,决定回什么(null = 不理)
export async function handleUpdate(update, { chatId, dataDir }) {
  const msg = update?.message;
  const incomingChatId = msg?.chat?.id;
  if (!msg?.text || incomingChatId == null || chatId == null || String(incomingChatId) !== String(chatId)) return null;
  const card = await latestCard(dataDir);
  if (!card) return '今晚还没开张。九点,老位置。';
  return (FOLLOWUP_FORMATTERS[card.source] ?? formatFollowupText)(card);
}

// 批红卡点「发 / 不发」后叫醒的执行器(python3,读得了 ~/Downloads)。任务在跑时再 kickstart 是空操作、退出码 0(2026-11-02 实测)。
export const RELEASE_LABEL = 'com.anxianjingya.autopub-release';
const DEFAULT_OPS_DIR = process.env.AUTOPUB_LOGDIR || join(homedir(), 'ops-logs', 'autopub');

function kickRelease() {
  return new Promise((resolve) => {
    execFile('/bin/launchctl', ['kickstart', `gui/${process.getuid()}/${RELEASE_LABEL}`], { timeout: 15000 },
      (err) => resolve(err ? (typeof err.code === 'number' ? err.code : -1) : 0));
  });
}

function defaultDecisionDeps(tg, log) {
  return {
    answer: (id, text) => answerCallback({ token: tg.token, id, text }),
    edit: ({ chatId, messageId, text }) => editMessage({ token: tg.token, chatId, messageId, text }),
    send: ({ chatId, text, replyMarkup }) => sendTelegramMessage({ token: tg.token, chatId, text, replyMarkup }),
    kick: kickRelease,
    now: () => Date.now(),
    log,
  };
}

export async function pollLoop(cfg) {
  const {
    dataDir, fetchImpl = fetch, sendImpl = sendTelegramMessage, log = console.log,
    // 连续 poll 失败到这个数就放弃进程,交给 launchd KeepAlive 重启:
    // undici 的连接池会复用已经死掉的 socket(2026-08-23 实测一个僵进程重试上千次
    // 都在往同一条 ESTABLISHED 死连接上打),原地重试再多也醒不过来,只有换进程才行。
    pollFailLimit = 10, retryDelayMs = 5000,
    onGiveUp = () => process.exit(1),
    opsDir = DEFAULT_OPS_DIR, decisionDeps,
  } = cfg;
  const offsetFile = join(dataDir, 'tg-offset.json');
  let pollFails = 0;

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
    } catch (e) {
      pollFails += 1;
      log(`[hippo-listen] poll error: ${e.message ?? e} (连续 ${pollFails}/${pollFailLimit}), retry in ${retryDelayMs / 1000}s`);
      if (pollFails >= pollFailLimit) {
        log(`[hippo-listen] 连续 ${pollFails} 次 poll 失败,退出让 launchd 重建连接`);
        return onGiveUp();
      }
      await sleep(retryDelayMs);
      continue;
    }
    pollFails = 0;

    const dctx = { chatId: tg.chatId, dataDir, opsDir, deps: decisionDeps ?? defaultDecisionDeps(tg, log) };
    let failed = false;
    for (const u of updates) {
      try {
        if (u.callback_query) {
          const tag = await handleCallback(u, dctx);
          log(`[hippo-listen] callback ${u.update_id}: ${tag}`);
          await writeJSONAtomic(offsetFile, { offset: u.update_id + 1 });
          continue;
        }
        const reply = await handleUpdate(u, { chatId: tg.chatId, dataDir });
        if (reply) {
          await sendImpl({ token: tg.token, chatId: tg.chatId, text: reply });
          log(`[hippo-listen] replied to update ${u.update_id}`);
        }
      } catch (e) {
        if (isPermanentTelegramError(e)) {
          await recordDeadLetter(dataDir, u, e);
          await writeJSONAtomic(offsetFile, { offset: u.update_id + 1 });
          log(`[hippo-listen] permanent error on ${u.update_id}; recorded dead letter and advanced offset`);
          continue;
        }
        log(`[hippo-listen] handle error on ${u.update_id}: ${e.message ?? e}; offset unchanged`);
        failed = true;
        break;
      }
      await writeJSONAtomic(offsetFile, { offset: u.update_id + 1 });
    }
    try { await settleDecisions(dctx); } catch (e) { log(`[hippo-listen] settle error: ${e.message ?? e}`); }
    if (cfg.once) return;
    if (failed) await sleep(5000);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = new URL('./data', import.meta.url).pathname;
  console.log('[hippo-listen] up');
  pollLoop({ dataDir }).catch((e) => { console.error('[hippo-listen] fatal', e); process.exit(1); });
}
