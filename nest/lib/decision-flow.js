import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJSON } from './store.js';
import {
  hasOption, keyboard, listDecisions, loadDecision, newId, nextDayAt, optionLabel, parseCb, saveDecision,
} from './decisions.js';

// 批红卡的状态机(plan v3 §1 三条规则):
// 1. 批的是这几条片子:payload 带 key+指纹,执行侧(python runner)按快照发。
// 2. 栅栏先行、结果优先:点击后先把 queued 落盘再做副作用;res 文件在就按它收尾,不看当前状态。
// 3. 真发布不自动重跑:这一条在 runner 里(started 标记),bot 这边只负责叫醒和改卡。
// bot 不读 ~/Downloads(launchd 下 node 读它会撞 TCC 卡死),只碰 data/ 与 ~/ops-logs/autopub/。

const KICK_EVERY_MS = 2 * 60000;
const KICK_FAIL_LIMIT = 3;
const LONG_RUN_MS = 120 * 60000;
const NOTIFY_EVERY_MS = 60000;
const NOTIFY_TRY_LIMIT = 30;

const exists = (p) => access(p).then(() => true, () => false);
const queueDir = (opsDir) => join(opsDir, 'release-queue');
const reqPath = (opsDir, id) => join(queueDir(opsDir), `${id}.req.json`);

export function isPermanentTelegramError(error) {
  const status = Number(error?.telegramCode ?? error?.status);
  return status >= 400 && status < 500 && status !== 429;
}

function reqBody(d) {
  return {
    id: d.id,
    action: d.choice === 'go' ? 'publish' : 'decline',
    date: d.payload.date,
    slot: d.payload.slot,
    dryRun: Boolean(d.payload.dryRun),
    entries: d.payload.entries,
  };
}

async function writeReq(opsDir, d) {
  await mkdir(queueDir(opsDir), { recursive: true, mode: 0o700 });
  const file = reqPath(opsDir, d.id);
  await writeFile(`${file}.tmp`, JSON.stringify(reqBody(d), null, 2), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

function pendingLine(d) {
  const dry = d.payload?.dryRun ? '(演练,不上传)' : '';
  if (d.choice === 'go') return `批红:发${dry} · 正在发,发完读回平台列表再改这张卡`;
  if (d.choice === 'no') return `批红:不发${dry} · 正在划掉`;
  return `批红:${optionLabel(d.kind, d.choice)}`;
}

const HEAD = {
  ok: '结论:发出去了(读回平台列表见到标题)',
  partial: '结论:只发成一部分',
  failed: '结论:没办成',
  stale: '结论:卡片过期了——这几条的内容在你批之后变了,一条都没发。要发就重新出一张卡再批。',
  unknown: '结论:结果不明——上次发到一半执行器断了,没有自动重试(怕重发)。CC 核对平台列表后再定。',
  dry: '演练结论(没有上传):',
  declined: '结论:不发',
  superseded: '这几条已经发完或划掉了,不再问。',
};

export function conclusionText(d) {
  const r = d.result ?? {};
  const head = d.kind === 'ping' ? '' : (HEAD[r.outcome] ?? `结论:${r.outcome}`);
  return [d.text, '', '━━━━━━━━━━', ...(head ? [head] : []), ...(r.lines ?? [])].join('\n');
}

// 只改卡、不碰执行。临时失败下一轮再试;永久失败或试满就补发一条短消息,之后不再管。
async function notify(d, ctx) {
  const { deps, dataDir, chatId } = ctx;
  const text = conclusionText(d);
  try {
    await deps.edit({ chatId, messageId: d.messageId, text });
    d.notified = true;
  } catch (e) {
    d.notifyTries = (d.notifyTries ?? 0) + 1;
    d.lastNotifyAt = deps.now();
    deps.log(`[decision] ${d.id} 改卡失败(第 ${d.notifyTries} 次): ${e?.message ?? e}`);
    if (isPermanentTelegramError(e) || d.notifyTries >= NOTIFY_TRY_LIMIT) {
      try { await deps.send({ chatId, text: `(原卡改不了,补一条)\n${text}` }); } catch (e2) {
        deps.log(`[decision] ${d.id} 补发也失败,放弃通知: ${e2?.message ?? e2}`);
      }
      d.notified = true;
    }
  }
  await saveDecision(dataDir, d);
}

async function kick(d, ctx) {
  const { deps, dataDir, opsDir } = ctx;
  let rc;
  try { rc = await deps.kick(); } catch (e) { rc = -1; deps.log(`[decision] kickstart 抛错: ${e?.message ?? e}`); }
  d.lastKickAt = deps.now();
  d.kickFails = rc === 0 ? 0 : (d.kickFails ?? 0) + 1;
  if (d.kickFails >= KICK_FAIL_LIMIT) {
    // 叫不醒执行器:撤掉请求,免得它哪天被别的东西叫醒、在卡片说「失败」之后才偷偷发出去
    try { await rename(reqPath(opsDir, d.id), `${reqPath(opsDir, d.id).replace(/\.req\.json$/, '')}.req.cancelled`); } catch { /* runner 已经接走 */ }
    if (!(await exists(join(queueDir(opsDir), `${d.id}.res.json`)))) {
      d.status = 'failed';
      d.result = { outcome: 'failed', lines: [`没叫醒执行器(launchctl 退出码 ${rc}),跟 CC 说一声`] };
    }
  }
  await saveDecision(dataDir, d);
}

// queued 但副作用没做完(崩在写 req 之前 / kickstart 没成):补做。req 内容由记录确定,重写安全。
async function repair(d, ctx) {
  const { opsDir } = ctx;
  if (d.result) return;
  const id = d.id;
  const q = queueDir(opsDir);
  const [hasReq, hasDone, hasRes, hasCancelled] = await Promise.all(
    [`${id}.req.json`, `${id}.req.done`, `${id}.res.json`, `${id}.req.cancelled`].map((n) => exists(join(q, n))),
  );
  if (hasRes || hasDone || hasCancelled) return;
  if (!hasReq) { await writeReq(opsDir, d); d.reqWrittenAt = ctx.deps.now(); await kick(d, ctx); return; }
  if (!d.lastKickAt || ctx.deps.now() - d.lastKickAt >= KICK_EVERY_MS) await kick(d, ctx);
}

// 一条按钮回调。返回一个字面标签方便测试与日志;本地写文件失败才抛出(offset 不推进,下轮重放)。
export async function handleCallback(update, ctx) {
  const { deps, dataDir, opsDir, chatId } = ctx;
  const cq = update.callback_query;
  const answer = async (text) => {
    try { await deps.answer(cq.id, text); } catch (e) { deps.log(`[decision] answer 失败: ${e?.message ?? e}`); }
  };
  const editBest = async (d, text) => {
    try { await deps.edit({ chatId, messageId: d.messageId ?? cq.message.message_id, text }); } catch (e) {
      deps.log(`[decision] ${d.id} 改卡失败(不影响执行): ${e?.message ?? e}`);
    }
  };
  const mine = (v) => v != null && chatId != null && String(v) === String(chatId);
  if (!mine(cq?.from?.id) || !mine(cq?.message?.chat?.id)) { await answer(); return 'ignored'; }

  const p = parseCb(cq.data);
  const d = p && await loadDecision(dataDir, p.id);
  if (!d) { await answer('这张卡我认不出了'); return 'unknown'; }
  if (!hasOption(d.kind, p.key)) { await answer('这张卡没有这个按钮'); return 'badkey'; }
  if (d.status !== 'pending') {
    await answer(`已经定过了:${optionLabel(d.kind, d.choice)}`);
    if (d.status === 'queued') await repair(d, ctx);
    return 'already';
  }
  d.messageId = d.messageId ?? cq.message.message_id;
  const now = deps.now();

  if (d.kind === 'ping') {
    Object.assign(d, { status: 'done', choice: p.key, decidedAt: now, result: { outcome: 'ok', lines: [`收到:${optionLabel(d.kind, p.key)}`] } });
    await saveDecision(dataDir, d);
    await answer('收到');
    await notify(d, ctx);
    return 'done';
  }

  if (p.key === 'later') {
    Object.assign(d, { status: 'snoozed', choice: 'later', decidedAt: now, reaskAt: nextDayAt(now) });
    await saveDecision(dataDir, d);
    await answer('好,明天再问');
    await editBest(d, `${d.text}\n\n━━━━━━━━━━\n改天 · 明天 18:15 再问你(还是这几条片子,不是明天排期里的)`);
    return 'snoozed';
  }

  // go / no:栅栏 → 写 req → 叫醒执行器 → 应答 → 改卡。栅栏之后的 Telegram 出错只记日志。
  Object.assign(d, { status: 'queued', choice: p.key, decidedAt: now });
  await saveDecision(dataDir, d);
  await writeReq(opsDir, d);
  d.reqWrittenAt = deps.now();
  await kick(d, ctx);
  await answer('收到');
  if (d.status === 'queued') await editBest(d, `${d.text}\n\n━━━━━━━━━━\n${pendingLine(d)}`);
  return 'queued';
}

async function publishedKeys(opsDir) {
  let txt = '';
  try { txt = await readFile(join(opsDir, 'published.jsonl'), 'utf8'); } catch { return new Set(); }
  const keys = new Set();
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    try { keys.add(JSON.parse(line).key); } catch { /* 坏行不挡路 */ }
  }
  return keys;
}

async function reask(d, ctx) {
  const { deps, dataDir, opsDir, chatId } = ctx;
  const done = await publishedKeys(opsDir);
  if ((d.payload?.entries ?? []).every((e) => done.has(e.key))) {
    Object.assign(d, { status: 'reasked', result: { outcome: 'superseded', lines: [] }, notified: false });
    await saveDecision(dataDir, d);
    return;
  }
  if (!d.successorId) { d.successorId = newId(deps.now()); await saveDecision(dataDir, d); }
  let s = await loadDecision(dataDir, d.successorId);
  if (!s) {
    s = { id: d.successorId, kind: d.kind, text: d.text, payload: d.payload, chatId: d.chatId ?? chatId, status: 'pending', reaskOf: d.id, createdAt: deps.now() };
    await saveDecision(dataDir, s);
  }
  if (!s.messageId) {
    // 只补发卡、只补 messageId,不动它的状态:它可能已经被点过(恢复时别把她的决定覆盖回 pending)
    const sent = await deps.send({ chatId, text: s.text, replyMarkup: keyboard(s) });
    const fresh = (await loadDecision(dataDir, s.id)) ?? s;
    fresh.messageId = sent?.message_id ?? null;
    await saveDecision(dataDir, fresh);
  }
  d.status = 'reasked';
  await saveDecision(dataDir, d);
}

// pollLoop 每轮跑一次。单条出错只记日志,不连累别的卡,也不连累 poll。
export async function settleDecisions(ctx) {
  const { deps, dataDir, opsDir } = ctx;
  for (const d of await listDecisions(dataDir)) {
    try {
      if (!d.result) {
        const res = await readJSON(join(queueDir(opsDir), `${d.id}.res.json`), null);
        if (res?.outcome) {
          d.result = { outcome: res.outcome, lines: Array.isArray(res.lines) ? res.lines.map(String) : [] };
          d.status = ['ok', 'dry', 'declined'].includes(res.outcome) ? 'done' : 'failed';
          d.notified = false;
          await saveDecision(dataDir, d);
        }
      }
      if (d.result && !d.notified && d.messageId) {
        if (!d.lastNotifyAt || deps.now() - d.lastNotifyAt >= NOTIFY_EVERY_MS) await notify(d, ctx);
        continue;
      }
      if (d.status === 'queued' && !d.result) {
        await repair(d, ctx);
        if (!d.result && !d.warnedLong && deps.now() - d.decidedAt >= LONG_RUN_MS) {
          d.warnedLong = true;
          await saveDecision(dataDir, d);
          try {
            await deps.edit({ chatId: ctx.chatId, messageId: d.messageId, text: `${d.text}\n\n━━━━━━━━━━\n${pendingLine(d)}\n还在跑(超过两小时了),结果出来我再改这张卡` });
          } catch (e) { deps.log(`[decision] ${d.id} 长跑提示没改成: ${e?.message ?? e}`); }
        }
      }
      if (d.status === 'snoozed' && d.reaskAt && deps.now() >= Date.parse(d.reaskAt)) await reask(d, ctx);
    } catch (e) {
      deps.log(`[decision] settle ${d.id} 出错: ${e?.message ?? e}`);
    }
  }
}

