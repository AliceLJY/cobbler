import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegramMessage, sendTelegramPhoto, splitForTelegram, formatHippoCardText, formatFollowupText, formatBookCardText, formatBookFollowupText, hippoFollowupBody } from '../lib/tg-send.js';

const ok = { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
const bad = { ok: false, status: 502, json: async () => ({ ok: false, description: 'bad gateway' }) };

test('成功路径:一次发出', async () => {
  let calls = 0;
  const r = await sendTelegramMessage({ token: 't', chatId: 1, text: 'x' }, { fetchImpl: async () => { calls++; return ok; } });
  assert.equal(r.message_id, 1);
  assert.equal(calls, 1);
});

test('失败重试后成功', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls < 3 ? bad : ok);
  const r = await sendTelegramMessage({ token: 't', chatId: 1, text: 'x' }, { fetchImpl, baseDelayMs: 1 });
  assert.equal(calls, 3);
  assert.equal(r.message_id, 1);
});

test('重试耗尽 → throw;缺 token → throw', async () => {
  await assert.rejects(
    sendTelegramMessage({ token: 't', chatId: 1, text: 'x' }, { fetchImpl: async () => bad, retries: 2, baseDelayMs: 1 }),
    /not ok \(502\)/,
  );
  await assert.rejects(sendTelegramMessage({ token: '', chatId: 1, text: 'x' }), /missing token/);
});

test('formatHippoCardText 纯文本简介卡,并直接带上追更条子(2026-10-17 起不列模型出的问题)', () => {
  const text = formatHippoCardText(
    { pageTitle: 'MediaPipe', pageFile: 'entities/MediaPipe.md', body: 'B', followups: ['F1', 'F2', 'F3'], mutter: 'M' },
    '2026-07-05',
  );
  assert.ok(text.startsWith('🥚 知识扭蛋 · 7月5日'));
  assert.ok(text.includes('「MediaPipe」'));
  assert.ok(text.includes('—— M'));
  assert.ok(!text.includes('回我一下'));
  assert.ok(text.includes('wiki/entities/MediaPipe.md'));
  // 追更三步:来源动静 / 还在不在用 / 默认不用改
  assert.ok(text.includes('追更') && text.includes('不是挑错'));
  assert.ok(text.includes('来源有没有新动静') && text.includes('还在不在用'));
  assert.ok(text.includes('默认结论是「不用改」'));
  assert.ok(text.includes('不要生造'));
  // 模型出的挑错式问题不再进条子(复盘:24 次扭蛋 100% 改 hippo,问题本身在要求挑错)
  assert.ok(!text.includes('F1') && !text.includes('F2'));
  assert.ok(!text.includes('*') && !text.includes('#'));
  // 卡的最后一段就是条子本体,发送时据此加代码块
  assert.ok(text.endsWith(hippoFollowupBody({ pageTitle: 'MediaPipe', pageFile: 'entities/MediaPipe.md' })));
});

test('formatFollowupText 追更条子含页面路径、标题和默认不用改', () => {
  const text = formatFollowupText({ pageTitle: 'MediaPipe', pageFile: 'entities/MediaPipe.md', followups: ['F1', 'F2'] });
  assert.ok(text.includes('wiki/entities/MediaPipe.md'));
  assert.ok(text.includes('「MediaPipe」'));
  assert.ok(text.includes('不用改'));
  assert.ok(!text.includes('1. F1'));
});

test('sendTelegramMessage 带 preTail:结尾那段作为代码块,offset/length 按 UTF-16 算', async () => {
  let captured;
  const fetchImpl = async (url, init) => { captured = JSON.parse(init.body); return ok; };
  const tail = '复制我:中文和 emoji 🥚 混排';
  const text = `🥚 卡面\n\n${tail}`;
  await sendTelegramMessage({ token: 't', chatId: 1, text, preTail: tail }, { fetchImpl });
  assert.deepEqual(captured.entities, [{ type: 'pre', offset: text.length - tail.length, length: tail.length }]);
  // 校准:按字节或按码点算都会和 UTF-16 对不上(🥚 占 2 个 UTF-16 单位)
  assert.notEqual(text.length, [...text].length);
});

test('sendTelegramMessage:preTail 不在结尾 / 不传 / 被拆条 → 不加代码块', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return ok; };
  await sendTelegramMessage({ token: 't', chatId: 1, text: 'A\nB', preTail: 'A' }, { fetchImpl });
  await sendTelegramMessage({ token: 't', chatId: 1, text: 'A\nB' }, { fetchImpl });
  const long = `${'x'.repeat(4000)}\n${'y'.repeat(200)}`;
  await sendTelegramMessage({ token: 't', chatId: 1, text: long, preTail: 'y'.repeat(200) }, { fetchImpl });
  assert.equal(bodies.length, 4);
  assert.ok(bodies.every((b) => b.entities === undefined));
});

test('sendTelegramPhoto 打 sendPhoto 端点,带 photo+caption', async () => {
  let captured;
  const fetchImpl = async (url, init) => { captured = { url, body: JSON.parse(init.body) }; return ok; };
  const r = await sendTelegramPhoto({ token: 't', chatId: 1, photo: 'https://img', caption: 'C' }, { fetchImpl });
  assert.equal(r.message_id, 1);
  assert.ok(captured.url.endsWith('/sendPhoto'));
  assert.equal(captured.body.photo, 'https://img');
  assert.equal(captured.body.caption, 'C');
  assert.equal(captured.body.chat_id, 1);
});

test('sendTelegramPhoto 失败重试 + 缺 token throw', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls < 2 ? bad : ok);
  await sendTelegramPhoto({ token: 't', chatId: 1, photo: 'p' }, { fetchImpl, baseDelayMs: 1 });
  assert.equal(calls, 2);
  await assert.rejects(sendTelegramPhoto({ token: '', chatId: 1, photo: 'p' }), /missing token/);
});

const BCARD = {
  bookTitle: '倦怠社会', bookAuthor: '韩炳哲', bookDir: 'd1-hash', body: 'B', mutter: 'M',
  quote: '过度的积极性是病灶', followups: ['F1', 'F2', 'F3'],
};

test('formatBookCardText 含书名/作者/引文/嘟囔,并直接带上条子', () => {
  const t = formatBookCardText(BCARD, '2026-07-11');
  assert.ok(t.startsWith('📖 书堆扭蛋 · 7月11日'));
  assert.ok(t.includes('《倦怠社会 · 韩炳哲》'));
  assert.ok(t.includes('"过度的积极性是病灶"'));
  assert.ok(t.includes('—— M'));
  // 条子直接进卡,不再让她回一句要
  assert.ok(!t.includes('回我一下'));
  assert.ok(t.includes('1. F1') && t.includes('2. F2') && t.includes('3. F3'));
  assert.ok(t.includes('ebook-query.py read'));
  assert.ok(t.includes("--book 'd1-hash' --chapter 'FULL.md'"));
  assert.ok(t.includes('不要生造文献'));
  assert.ok(t.includes('Cobbler 猜') && t.includes('不是我的判断'));
});

test('formatBookCardText 长度留足 Telegram 4096 余量(最坏情况)', () => {
  const worst = {
    bookTitle: '书'.repeat(40), bookAuthor: '作'.repeat(20), bookDir: 'd'.repeat(120),
    body: 'b'.repeat(140), mutter: 'm'.repeat(40), quote: 'q'.repeat(80),
    followups: Array.from({ length: 7 }, (_, i) => `${i}`.repeat(80)),
  };
  assert.ok(formatBookCardText(worst, '2026-07-11').length < 4096);
});

test('formatBookCardText 无 quote 不留引文行', () => {
  const t = formatBookCardText({ ...BCARD, quote: null }, '2026-07-11');
  assert.ok(!t.includes('"') || !t.includes('\n\n\n'));
});

test('formatBookFollowupText 条子只引导统一入口查询 mini', () => {
  const t = formatBookFollowupText(BCARD);
  assert.ok(t.includes('ebook-query.py read'));
  assert.ok(t.includes("--book 'd1-hash' --chapter 'FULL.md'"));
  assert.ok(t.includes("--grep '过度的积极性是病灶' --context 8"));
  assert.ok(t.includes('正式消费库只在 mini'));
  assert.ok(t.includes('输出路径应以 mini: 开头'));
  assert.ok(!t.includes('cc-ingested/d1-hash/FULL.md'));
  assert.ok(t.includes('1. F1') && t.includes('2. F2') && t.includes('3. F3'));
});

test('formatBookFollowupText 对目录和引文做 shell quoting', () => {
  const t = formatBookFollowupText({ ...BCARD, bookDir: "alice's-book", quote: "reader's anchor" });
  assert.ok(t.includes("--book 'alice'\"'\"'s-book'"));
  assert.ok(t.includes("--grep 'reader'\"'\"'s anchor'"));
});

// —— 条子不限字数后,4096 兜底 ——
test('splitForTelegram 不超限时原样单条', () => {
  assert.deepEqual(splitForTelegram('a\nb'), ['a\nb']);
});

test('splitForTelegram 超限按行拆,不丢字不断行', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `${i}`.padEnd(100, 'x'));
  const text = lines.join('\n');
  const parts = splitForTelegram(text, 1000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.equal(parts.join('\n'), text); // 一个字都没丢
});

test('splitForTelegram 单行本身超限也硬切不丢字', () => {
  const text = 'z'.repeat(2500);
  const parts = splitForTelegram(text, 1000);
  assert.equal(parts.length, 3);
  assert.equal(parts.join(''), text);
});

test('sendTelegramMessage 超长自动分多条发出,不让整条 400 失败', async () => {
  const sent = [];
  const fetchImpl = async (_url, init) => { sent.push(JSON.parse(init.body).text); return ok; };
  await sendTelegramMessage({ token: 't', chatId: 1, text: 'y'.repeat(9000) }, { fetchImpl });
  assert.equal(sent.length, 3);
  assert.ok(sent.every((t) => t.length <= 4096));
  assert.equal(sent.join('').length, 9000);
});

// —— 降级要在卡面看得见,不只在日志里 ——
test('fallback 卡在条子上方标出「这组是兜底问题」,正常卡不标', () => {
  const marked = formatBookCardText({ ...BCARD, fallback: true }, '2026-07-11');
  assert.ok(marked.includes('兜底的通用问题'));
  assert.ok(!formatBookCardText(BCARD, '2026-07-11').includes('兜底的通用问题'));

  // 知识扭蛋 10-17 起条子是固定的追更三步,不再用模型出的问题,所以兜底与否条子都一样、不再标
  const hCard = { pageTitle: 'P', pageFile: 'concepts/P.md', body: 'B', mutter: 'M', followups: ['F1', 'F2', 'F3'] };
  assert.ok(!formatHippoCardText({ ...hCard, fallback: true }, '2026-07-05').includes('兜底的通用问题'));
  assert.ok(!formatHippoCardText(hCard, '2026-07-05').includes('兜底的通用问题'));
});
