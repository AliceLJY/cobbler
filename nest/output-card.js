// 产出回捞卡（2026-10-31 立）：工作日 08:20 从 AI产出 里「状态: 等Alice」的批次抽一张发 TG，
// 卡里带一段可复制给 CC 的条子，她回「做 / 不做了 / 晚点」，CC 改 README 状态行，池子靠她的回答自己变干净。
// 零模型调用、零 token；池子空了就静默退出（退出码 0，不算失败）。
// 用法: node output-card.js            正式跑（发 TG、写历史）
//       node output-card.js --dry-run  只打印卡片文本，不发、不写历史
// 环境: COBBLER_OUTPUT_DIR 覆盖 AI产出 路径（默认 ~/Downloads/sync-bridge/AI产出）
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listOutputBatches, pickOutputBatch, pendingBatches, daysBetween } from './lib/output-pick.js';
import { sendTelegramMessage } from './lib/tg-send.js';
import { readJSON, writeJSONAtomic } from './lib/store.js';
import { localDateISO } from './lib/dates.js';
import { notifyFailure, shortHostname, firstLine } from './lib/notify-fail.js';

const HISTORY_LIMIT = 365;
const DEFAULT_OUTPUT_DISPLAY = '~/Downloads/sync-bridge/AI产出';

export function outputFollowupBody(card, outputDisplay = DEFAULT_OUTPUT_DISPLAY) {
  return [
    `产出回捞：请读 ${outputDisplay}/${card.dir}/README.md，这批在等我「${card.note}」。`,
    '按我的决定处理：「做」就按 README 开干，要开新窗口就给我话术；「不做了」把 README 的状态行改成「状态: 已放弃 ｜ <今天日期> 她说不做了」；「晚点」把状态行改成「状态: 等Alice ｜ 原句（<今天日期>看过，晚点）」。改完回我一句。',
    '我的决定：',
  ].join('\n');
}

export function formatOutputCardText(card, todayISO, poolSize, outputDisplay = DEFAULT_OUTPUT_DISPLAY) {
  const [, m, d] = todayISO.split('-');
  const [, bm, bd] = card.date.split('-');
  const age = daysBetween(card.date, todayISO);
  const rest = poolSize - 1;
  return [
    `🎁 产出回捞 · ${Number(m)}月${Number(d)}日`,
    '',
    `「${card.dir}」`,
    `${Number(bm)}月${Number(bd)}日的产出，${age} 天没人管了。`,
    '',
    `在等你：${card.note}`,
    '',
    rest > 0 ? `池里还有 ${rest} 份在等你，一天一张，不急。` : '这是池里最后一份。',
    '',
    '━━━━━━━━━━',
    '轻点下面方框就整段复制，末尾补上「做 / 不做了 / 晚点」，发给隔壁大个子:',
    '',
    outputFollowupBody(card, outputDisplay),
  ].join('\n');
}

export async function runOutputCard(cfg) {
  const { outputDir, dataDir, todayISO, dryRun = false } = cfg;
  const log = cfg.log ?? console.error;
  const send = cfg.sendImpl ?? sendTelegramMessage;

  const batches = await listOutputBatches(outputDir);
  const historyFile = join(dataDir, 'output-history.json');
  const history = await readJSON(historyFile, []);
  const pool = pendingBatches(batches, todayISO);
  const pick = pickOutputBatch(batches, history, todayISO);
  if (!pick) {
    log(`[cobbler-output] 池子空（带状态行 ${batches.length} 批，等Alice 且满 2 天 0 批），今天不发`);
    return { delivered: 'none', empty: true, batches: batches.length };
  }
  const card = { date: todayISO, dir: pick.dir, batchDate: pick.date, note: pick.note, poolSize: pool.length, source: 'output' };
  const text = formatOutputCardText(card, todayISO, pool.length);
  const preTail = outputFollowupBody(card);
  if (dryRun) return { ...card, delivered: 'dry-run', text };

  await writeJSONAtomic(join(dataDir, 'output-cards', `${todayISO}.json`), card);
  // 凭证坏了不能算成功（同 hippo-card 2026-09-17 的改法）
  const tg = await readJSON(join(dataDir, 'tg.json'), null);
  if (!tg?.token || !tg?.chatId) throw new Error('tg.json 缺 token/chatId，卡片已写 data/output-cards 未送达');
  await send({ token: tg.token, chatId: tg.chatId, text, preTail });
  await writeJSONAtomic(historyFile, [...history, { dir: pick.dir, date: todayISO }].slice(-HISTORY_LIMIT));
  return { ...card, delivered: 'tg', text };
}

export async function outputCardMain(cfg, io = {}) {
  const out = io.out ?? console.log;
  const err = io.err ?? console.error;
  const notify = io.notify ?? notifyFailure;
  try {
    const c = await runOutputCard(cfg);
    if (c.empty) { out(`[cobbler-output] ${new Date().toISOString()} empty-pool batches=${c.batches}`); return c; }
    if (c.delivered === 'dry-run') { out(c.text); return c; }
    out(`[cobbler-output] ${new Date().toISOString()} ok dir="${c.dir}" pool=${c.poolSize} delivered=${c.delivered}`);
    return c;
  } catch (e) {
    err(`[cobbler-output] ${new Date().toISOString()} fail`, e);
    process.exitCode = 1;
    await notify(`产出回捞 08:20 失败@${shortHostname()}：${firstLine(e)}；日志 ~/Projects/cobbler/nest/data/output.log`, { log: err });
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const HOME = process.env.HOME;
  outputCardMain({
    outputDir: process.env.COBBLER_OUTPUT_DIR ?? `${HOME}/Downloads/sync-bridge/AI产出`,
    dataDir: new URL('./data', import.meta.url).pathname,
    todayISO: localDateISO(),
    dryRun: process.argv.includes('--dry-run'),
  });
}
