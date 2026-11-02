import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleCallback, settleDecisions, conclusionText } from '../lib/decision-flow.js';
import { cbData, keyboard, loadDecision, nextDayAt, parseCb, saveDecision, validatePayload } from '../lib/decisions.js';
import { ask } from '../ask.js';
import { pollLoop } from '../tg-listener.js';

const CHAT = 4242;
const PAYLOAD = {
  date: '2026-11-03', slot: '18:30', dryRun: false,
  entries: [
    { key: '视频号|2026-11-03|18:30|87', platform: '视频号', name: '像素办公室的一天', fp: '0123456789abcdef' },
    { key: '快手|2026-11-03|18:30|87', platform: '快手', name: '像素办公室的一天', fp: 'fedcba9876543210' },
  ],
};

async function harness(fn, { kickRc = 0, editImpl } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'decision-'));
  const dataDir = join(root, 'data');
  const opsDir = join(root, 'ops');
  await mkdir(dataDir); await mkdir(opsDir);
  let t = Date.parse('2026-11-02T13:00:00Z');
  const calls = { answer: [], edit: [], send: [], kick: 0 };
  let rc = kickRc;
  const deps = {
    answer: async (id, text) => { calls.answer.push(text); },
    edit: editImpl ?? (async (a) => { calls.edit.push(a); }),
    send: async (a) => { calls.send.push(a); return { message_id: 900 + calls.send.length }; },
    kick: async () => { calls.kick += 1; return typeof rc === 'function' ? rc() : rc; },
    now: () => t,
    log: () => {},
  };
  const ctx = { chatId: String(CHAT), dataDir, opsDir, deps };
  const api = {
    root, dataDir, opsDir, ctx, calls, deps,
    advance: (ms) => { t += ms; },
    setKick: (v) => { rc = v; },
    q: (name) => join(opsDir, 'release-queue', name),
    seed: async (over = {}) => saveDecision(dataDir, { id: 'card01ab', kind: 'autopub-release', text: '卡片正文', payload: PAYLOAD, chatId: CHAT, status: 'pending', messageId: 55, ...over }),
    tap: (key, { id = 'card01ab', from = CHAT, chat = CHAT, data } = {}) => handleCallback({
      callback_query: { id: 'cq', data: data ?? `d:${id}:${key}`, from: { id: from }, message: { message_id: 55, chat: { id: chat } } },
    }, ctx),
  };
  try { await fn(api); } finally { await rm(root, { recursive: true, force: true }); }
}

const exists = (p) => stat(p).then(() => true, () => false);
const readJ = async (p) => JSON.parse(await readFile(p, 'utf8'));

test('parseCb / cbData 往返,未知形状一律 null,不超 64 字节', () => {
  assert.deepEqual(parseCb(cbData('card01ab', 'later')), { id: 'card01ab', key: 'later' });
  for (const bad of [null, '', 'x', 'd:../etc:go', 'd:card01ab:GO', 'd:card01ab:go:x']) assert.equal(parseCb(bad), null);
  const kb = keyboard({ id: 'card01ab', kind: 'autopub-release' });
  assert.deepEqual(kb.inline_keyboard[0].map((b) => b.text), ['发', '改天', '不发']);
  for (const b of kb.inline_keyboard[0]) assert.ok(Buffer.byteLength(b.callback_data) <= 64);
});

test('validatePayload:key 必须与 platform/date/slot 一致,fp 必须是 16 位十六进制', () => {
  assert.equal(validatePayload('autopub-release', PAYLOAD), null);
  const mut = (f) => { const p = structuredClone(PAYLOAD); f(p); return validatePayload('autopub-release', p); };
  assert.match(mut((p) => { p.entries[0].key = '视频号|2026-11-04|18:30|87'; }), /对不上/);
  assert.match(mut((p) => { p.entries[0].platform = '快手'; }), /对不上/);
  assert.match(mut((p) => { p.entries[0].fp = 'xyz'; }), /fp/);
  assert.match(mut((p) => { p.entries = []; }), /1–6/);
  assert.match(mut((p) => { p.slot = '6:30'; }), /slot/);
  assert.match(mut((p) => { p.dryRun = 'yes'; }), /dryRun/);
  assert.equal(validatePayload('ping', {}), null);
});

test('nextDayAt:按东八区算次日 18:15,不看进程时区', () => {
  assert.equal(nextDayAt(Date.parse('2026-11-02T13:00:00Z')), '2026-11-03T10:15:00.000Z'); // 北京 11-02 21:00 → 11-03 18:15
  assert.equal(nextDayAt(Date.parse('2026-11-02T17:30:00Z')), '2026-11-04T10:15:00.000Z'); // 北京已是 11-03 01:30 → 11-04
});

test('陌生人 / 别的 chat / 缺 message 的回调:只空答,不动状态、不写 req、不踢', async () => harness(async (h) => {
  await h.seed();
  assert.equal(await h.tap('go', { from: 999 }), 'ignored');
  assert.equal(await h.tap('go', { chat: 999 }), 'ignored');
  assert.equal(await handleCallback({ callback_query: { id: 'x', data: 'd:card01ab:go', from: { id: CHAT } } }, h.ctx), 'ignored');
  assert.equal((await loadDecision(h.dataDir, 'card01ab')).status, 'pending');
  assert.equal(h.calls.kick, 0);
  assert.equal(await exists(h.q('card01ab.req.json')), false);
}));

test('chatId 字符串与数字混用照样认得出本人', async () => harness(async (h) => {
  await h.seed();
  h.ctx.chatId = CHAT; // 数字
  assert.equal(await h.tap('go', { from: String(CHAT), chat: String(CHAT) }), 'queued');
}));

test('认不出的卡 / 不属于这个 kind 的按钮:答一句,不执行', async () => harness(async (h) => {
  await h.seed();
  assert.equal(await h.tap('go', { id: 'nosuchcard' }), 'unknown');
  assert.equal(await h.tap('ok'), 'badkey');
  assert.deepEqual(h.calls.answer, ['这张卡我认不出了', '这张卡没有这个按钮']);
  assert.equal(h.calls.kick, 0);
}));

test('点「发」:先落 queued 再写 req 再踢;req 自带日期时段与批准条目;改卡去按钮', async () => harness(async (h) => {
  await h.seed();
  let statusAtKick;
  h.deps.kick = async () => { statusAtKick = (await loadDecision(h.dataDir, 'card01ab')).status; h.calls.kick += 1; return 0; };
  assert.equal(await h.tap('go'), 'queued');
  assert.equal(statusAtKick, 'queued', '踢执行器之前栅栏必须已落盘');
  const req = await readJ(h.q('card01ab.req.json'));
  assert.deepEqual(req, { id: 'card01ab', action: 'publish', date: '2026-11-03', slot: '18:30', dryRun: false, entries: PAYLOAD.entries });
  assert.equal(h.calls.kick, 1);
  assert.deepEqual(h.calls.answer, ['收到']);
  assert.match(h.calls.edit[0].text, /正在发/);
  assert.equal(h.calls.edit[0].messageId, 55);
}));

test('点「不发」:req 的 action 是 decline', async () => harness(async (h) => {
  await h.seed();
  await h.tap('no');
  assert.equal((await readJ(h.q('card01ab.req.json'))).action, 'decline');
}));

test('点「改天」:snoozed + choice + 次日 18:15,不写 req、不踢', async () => harness(async (h) => {
  await h.seed();
  assert.equal(await h.tap('later'), 'snoozed');
  const d = await loadDecision(h.dataDir, 'card01ab');
  assert.equal(d.status, 'snoozed');
  assert.equal(d.choice, 'later');
  assert.equal(d.reaskAt, '2026-11-03T10:15:00.000Z');
  assert.equal(h.calls.kick, 0);
  assert.equal(await exists(h.q('card01ab.req.json')), false);
  assert.match(h.calls.edit[0].text, /明天 18:15 再问你/);
}));

test('双击:第二下只答「已经定过了」,只踢一次、req 不重写', async () => harness(async (h) => {
  await h.seed();
  await h.tap('go');
  assert.equal(await h.tap('go'), 'already');
  assert.equal(await h.tap('no'), 'already');
  assert.equal(h.calls.kick, 1);
  assert.match(h.calls.answer.at(-1), /已经定过了:发/);
  assert.equal((await readJ(h.q('card01ab.req.json'))).action, 'publish');
}));

test('栅栏之后 answer / edit 抛错:req 照写、照踢,不影响执行', async () => harness(async (h) => {
  await h.seed();
  h.deps.answer = async () => { throw new Error('timeout'); };
  h.deps.edit = async () => { throw new Error('502'); };
  assert.equal(await h.tap('go'), 'queued');
  assert.equal(await exists(h.q('card01ab.req.json')), true);
  assert.equal(h.calls.kick, 1);
}));

test('崩在栅栏之后、写 req 之前:settle 补写 req 并踢;已有 .req.done 则不补写', async () => harness(async (h) => {
  await h.seed({ status: 'queued', choice: 'go', decidedAt: Date.parse('2026-11-02T12:59:00Z') });
  await settleDecisions(h.ctx);
  assert.equal(await exists(h.q('card01ab.req.json')), true);
  assert.equal(h.calls.kick, 1);

  await h.seed({ id: 'card02ab', status: 'queued', choice: 'go', decidedAt: 0 });
  await writeFile(h.q('card02ab.req.done'), '{}');
  await settleDecisions(h.ctx);
  assert.equal(await exists(h.q('card02ab.req.json')), false, '已完成的请求不能被重新排队');
}));

test('req 在、没结果:隔 2 分钟才再踢一次(踢在跑的任务是空操作)', async () => harness(async (h) => {
  await h.seed();
  await h.tap('go');
  await settleDecisions(h.ctx);
  assert.equal(h.calls.kick, 1, '刚踢过不重踢');
  h.advance(2 * 60000);
  await settleDecisions(h.ctx);
  assert.equal(h.calls.kick, 2);
}));

test('kickstart 连续 3 次非 0:撤掉 req、卡改失败;第 1、2 次只记账不判失败', async () => harness(async (h) => {
  await h.seed();
  h.setKick(113);
  await h.tap('go');
  assert.equal((await loadDecision(h.dataDir, 'card01ab')).status, 'queued');
  for (let i = 0; i < 2; i++) { h.advance(2 * 60000); await settleDecisions(h.ctx); }
  const d = await loadDecision(h.dataDir, 'card01ab');
  assert.equal(d.status, 'failed');
  assert.match(d.result.lines[0], /退出码 113/);
  assert.equal(await exists(h.q('card01ab.req.json')), false);
  assert.equal(await exists(h.q('card01ab.req.cancelled')), true);
  await settleDecisions(h.ctx);
  assert.match(h.calls.edit.at(-1).text, /没叫醒执行器/);
}));

test('res 在:不管当前状态都收尾;改成结论、去按钮,只改一次', async () => harness(async (h) => {
  await h.seed({ status: 'failed', result: undefined }); // 哪怕状态已被判失败,迟到的结果照收
  await mkdir(join(h.opsDir, 'release-queue'), { recursive: true });
  await writeFile(h.q('card01ab.res.json'), JSON.stringify({ outcome: 'ok', lines: ['视频号:已发出', '快手:已发出'] }));
  await settleDecisions(h.ctx);
  const d = await loadDecision(h.dataDir, 'card01ab');
  assert.equal(d.status, 'done');
  assert.equal(d.notified, true);
  assert.match(h.calls.edit[0].text, /结论:发出去了[\s\S]*视频号:已发出/);
  await settleDecisions(h.ctx);
  assert.equal(h.calls.edit.length, 1);
}));

test('改卡临时失败:结果已存,隔 60 秒重试,成功后停;永远不重新执行', async () => harness(async (h) => {
  let fails = 2;
  h.deps.edit = async (a) => { if (fails-- > 0) throw Object.assign(new Error('Too Many Requests'), { status: 429 }); h.calls.edit.push(a); };
  await h.seed({ status: 'queued', choice: 'go', decidedAt: 0 });
  await mkdir(join(h.opsDir, 'release-queue'), { recursive: true });
  await writeFile(h.q('card01ab.res.json'), JSON.stringify({ outcome: 'partial', lines: ['快手:没发成'] }));
  await writeFile(h.q('card01ab.req.done'), '{}');
  await settleDecisions(h.ctx);
  let d = await loadDecision(h.dataDir, 'card01ab');
  assert.equal(d.status, 'failed');
  assert.equal(d.notified, false);
  await settleDecisions(h.ctx);
  assert.equal((await loadDecision(h.dataDir, 'card01ab')).notifyTries, 1, '没到 60 秒不重试');
  h.advance(60000); await settleDecisions(h.ctx);
  h.advance(60000); await settleDecisions(h.ctx);
  d = await loadDecision(h.dataDir, 'card01ab');
  assert.equal(d.notified, true);
  assert.equal(h.calls.edit.length, 1);
  assert.equal(h.calls.kick, 0, '通知失败不能触发重新执行');
}));

test('改卡永久失败(消息被删):补发一条短消息,之后不再管', async () => harness(async (h) => {
  h.deps.edit = async () => { throw Object.assign(new Error('message to edit not found'), { status: 400 }); };
  await h.seed({ status: 'queued', choice: 'go', decidedAt: 0 });
  await mkdir(join(h.opsDir, 'release-queue'), { recursive: true });
  await writeFile(h.q('card01ab.res.json'), JSON.stringify({ outcome: 'ok', lines: [] }));
  await settleDecisions(h.ctx);
  assert.equal(h.calls.send.length, 1);
  assert.match(h.calls.send[0].text, /原卡改不了/);
  h.advance(10 * 60000); await settleDecisions(h.ctx);
  assert.equal(h.calls.send.length, 1);
}));

test('跑满 120 分钟:只提示一次「还在跑」,不判失败,迟到结果照收', async () => harness(async (h) => {
  await h.seed();
  await h.tap('go');
  h.advance(121 * 60000);
  await settleDecisions(h.ctx);
  await settleDecisions(h.ctx);
  assert.equal(h.calls.edit.filter((e) => /还在跑/.test(e.text)).length, 1);
  assert.equal((await loadDecision(h.dataDir, 'card01ab')).status, 'queued');
  await writeFile(h.q('card01ab.res.json'), JSON.stringify({ outcome: 'ok', lines: [] }));
  await settleDecisions(h.ctx);
  assert.equal((await loadDecision(h.dataDir, 'card01ab')).status, 'done');
}));

test('改天到点:批准的 key 全已发 → 不发新卡、旧卡改「不再问」', async () => harness(async (h) => {
  await h.seed();
  await h.tap('later');
  await writeFile(join(h.opsDir, 'published.jsonl'), PAYLOAD.entries.map((e) => JSON.stringify({ key: e.key, how: 'published' })).join('\n') + '\n');
  h.advance(22 * 3600000);
  await settleDecisions(h.ctx);
  await settleDecisions(h.ctx);
  assert.equal(h.calls.send.length, 0);
  assert.match(h.calls.edit.at(-1).text, /已经发完或划掉了/);
}));

test('改天到点:发一张后继卡(同 payload、新 id、带按钮);再跑 settle 不重复发', async () => harness(async (h) => {
  await h.seed();
  await h.tap('later');
  h.advance(22 * 3600000);
  await settleDecisions(h.ctx);
  await settleDecisions(h.ctx);
  assert.equal(h.calls.send.length, 1);
  const old = await loadDecision(h.dataDir, 'card01ab');
  assert.equal(old.status, 'reasked');
  const s = await loadDecision(h.dataDir, old.successorId);
  assert.equal(s.status, 'pending');
  assert.deepEqual(s.payload, PAYLOAD);
  assert.equal(s.messageId, 901);
  assert.equal(h.calls.send[0].replyMarkup.inline_keyboard[0][0].callback_data, `d:${s.id}:go`);
}));

test('改天恢复:后继卡已被点过(崩在旧卡标 reasked 之前),恢复不能把它覆盖回 pending', async () => harness(async (h) => {
  await h.seed({ status: 'snoozed', choice: 'later', reaskAt: '2026-11-02T12:00:00Z', successorId: 'succ01ab' });
  await saveDecision(h.dataDir, { id: 'succ01ab', kind: 'autopub-release', text: '卡片正文', payload: PAYLOAD, status: 'queued', choice: 'go', decidedAt: 1, messageId: 77 });
  await settleDecisions(h.ctx);
  const s = await loadDecision(h.dataDir, 'succ01ab');
  assert.equal(s.status, 'queued');
  assert.equal(s.choice, 'go');
  assert.equal(h.calls.send.length, 0, '后继已有 messageId,不再发卡');
  assert.equal((await loadDecision(h.dataDir, 'card01ab')).status, 'reasked');
}));

test('ping 卡:点了就结论,不写 req、不踢', async () => harness(async (h) => {
  await saveDecision(h.dataDir, { id: 'ping01ab', kind: 'ping', text: '试一下按钮', payload: {}, status: 'pending', messageId: 55 });
  assert.equal(await h.tap('ok', { id: 'ping01ab' }), 'done');
  assert.equal(h.calls.kick, 0);
  assert.match(h.calls.edit[0].text, /收到:好/);
  assert.equal((await loadDecision(h.dataDir, 'ping01ab')).notified, true);
}));

test('conclusionText:各结论都有一句人话开头', () => {
  for (const outcome of ['ok', 'partial', 'failed', 'stale', 'unknown', 'dry', 'declined']) {
    const t = conclusionText({ kind: 'autopub-release', text: 'T', result: { outcome, lines: ['x'] } });
    assert.match(t, /^T\n\n━+\n\S/);
  }
});

test('ask:合格输入落 pending 记录并带按钮发出;不合格退出 2、不发', async () => harness(async (h) => {
  await writeFile(join(h.dataDir, 'tg.json'), JSON.stringify({ token: 't', chatId: CHAT }));
  const sent = [];
  const r = await ask({ kind: 'autopub-release', text: '卡', payload: PAYLOAD }, { dataDir: h.dataDir, sendImpl: async (a) => { sent.push(a); return { message_id: 12 }; } });
  assert.equal(r.code, 0);
  const d = await loadDecision(h.dataDir, r.id);
  assert.equal(d.status, 'pending');
  assert.equal(d.messageId, 12);
  assert.equal(sent[0].replyMarkup.inline_keyboard[0].length, 3);
  const mode = (await stat(join(h.dataDir, 'decisions', `${r.id}.json`))).mode & 0o777;
  assert.equal(mode, 0o600);

  const bad = await ask({ kind: 'autopub-release', text: '卡', payload: { ...PAYLOAD, slot: 'x' } }, { dataDir: h.dataDir, sendImpl: async () => { throw new Error('不该发'); } });
  assert.equal(bad.code, 2);
  const fail = await ask({ kind: 'ping', text: '卡' }, { dataDir: h.dataDir, sendImpl: async () => { throw new Error('net'); } });
  assert.equal(fail.code, 1);
  const names = await readdir(join(h.dataDir, 'decisions'));
  const failed = await Promise.all(names.map((n) => readJ(join(h.dataDir, 'decisions', n))));
  assert.equal(failed.filter((x) => x.status === 'pending').length, 1, '发送失败不留 pending');
}));

test('pollLoop:回调走批红流程并推进 offset,message 流照旧;每轮都跑 settle', async () => harness(async (h) => {
  await writeFile(join(h.dataDir, 'tg.json'), JSON.stringify({ token: 't', chatId: CHAT }));
  await h.seed();
  await mkdir(join(h.opsDir, 'release-queue'), { recursive: true });
  await saveDecision(h.dataDir, { id: 'done01ab', kind: 'ping', text: 'x', payload: {}, status: 'queued', messageId: 9 });
  await writeFile(h.q('done01ab.res.json'), JSON.stringify({ outcome: 'ok', lines: [] }));
  const updates = [{ update_id: 20, callback_query: { id: 'c', data: 'd:card01ab:go', from: { id: CHAT }, message: { message_id: 55, chat: { id: CHAT } } } }];
  await pollLoop({
    dataDir: h.dataDir, opsDir: h.opsDir, decisionDeps: h.deps, log: () => {}, once: true,
    fetchImpl: async () => ({ json: async () => ({ ok: true, result: updates }) }),
    sendImpl: async () => { throw new Error('message 流不该被调'); },
  });
  assert.deepEqual(JSON.parse(await readFile(join(h.dataDir, 'tg-offset.json'), 'utf8')), { offset: 21 });
  assert.equal(h.calls.kick, 1);
  assert.equal((await loadDecision(h.dataDir, 'done01ab')).status, 'done', 'settle 在同一轮跑过');
}));
