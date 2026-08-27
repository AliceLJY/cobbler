import { truncate } from './templates.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callTelegram({ token, method, body }, opts = {}) {
  const { fetchImpl = fetch, retries = 3, baseDelayMs = 2000, timeoutMs = 15000 } = opts;
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const resBody = await res.json().catch(() => ({}));
      if (res.ok && resBody.ok) return resBody.result;
      lastErr = new Error(`tg-send: api not ok (${res.status}) ${resBody.description ?? ''}`);
      lastErr.status = res.status;
      lastErr.telegramCode = resBody.error_code;
    } catch (e) { lastErr = e; }
    if (i < retries - 1) await sleep(baseDelayMs * 2 ** i);
  }
  throw lastErr;
}

const TG_TEXT_LIMIT = 4096;

// 条子不限单条字数(她要"有分量"的问题),于是这里兜住 Telegram 的 4096 硬限:
// 超了就按行拆成多条发,而不是让整条消息 400 失败 —— 那样她那天什么都收不到。
export function splitForTelegram(text, limit = TG_TEXT_LIMIT) {
  if (text.length <= limit) return [text];
  const parts = [];
  let buf = '';
  const flush = () => { if (buf) { parts.push(buf); buf = ''; } };
  for (const line of text.split('\n')) {
    if (line.length > limit) { // 单行就超限(极端长的一条问题):硬切,不丢字
      flush();
      for (let i = 0; i < line.length; i += limit) parts.push(line.slice(i, i + limit));
      continue;
    }
    if (buf.length + line.length + 1 > limit) flush();
    buf = buf ? `${buf}\n${line}` : line;
  }
  flush();
  return parts;
}

export async function sendTelegramMessage({ token, chatId, text }, opts = {}) {
  if (!token || !chatId) throw new Error('tg-send: missing token/chatId');
  let last;
  for (const part of splitForTelegram(text)) {
    last = await callTelegram({ token, method: 'sendMessage', body: { chat_id: chatId, text: part } }, opts);
  }
  return last;
}

export async function sendTelegramPhoto({ token, chatId, photo, caption }, opts = {}) {
  if (!token || !chatId) throw new Error('tg-send: missing token/chatId');
  return callTelegram({ token, method: 'sendPhoto', body: { chat_id: chatId, photo, caption } }, opts);
}

const DEFAULT_HIPPO_DIR = '~/Projects/河马项目/hippo-wiki';

// 条子正文:wiki 页路径 + 问题清单 + 防编造要求。卡和"再要一次"的回复共用,避免漂移。
function hippoFollowupBody(card, hippoDirDisplay = DEFAULT_HIPPO_DIR) {
  const qs = (card.followups ?? []).map((f, i) => `${i + 1}. ${f}`).join('\n');
  return [
    `请读 ${hippoDirDisplay}/wiki/${card.pageFile},这是我自己研究过存下来的一页。`,
    `读完再逐条回答(页:「${card.pageTitle}」):`,
    '',
    qs,
    '',
    '逐条答,结合这页原文和我现在的项目说,别泛泛。能给具体人名、项目名、年份、',
    '数字的地方就给;拿不准的明确标"不确定",不要生造事实——编一条我整份都不用。',
  ].join('\n');
}

// 条子直接拼进卡里,不再等她回一句 —— 她每天都会去问,多一轮往返只是给它机会掉链。
export function formatHippoCardText(card, dateISO, hippoDirDisplay = DEFAULT_HIPPO_DIR) {
  const [, m, d] = dateISO.split('-');
  return [
    `🥚 知识扭蛋 · ${Number(m)}月${Number(d)}日`,
    '',
    `「${card.pageTitle}」`,
    '',
    card.body,
    '',
    `—— ${card.mutter}`,
    '',
    '━━━━━━━━━━',
    ...(card.fallback
      ? ['(今天模型没写成条子,下面这组是兜底的通用问题,不针对这一页。)', '']
      : []),
    '条子拿好,整段复制发给隔壁大个子:',
    '',
    hippoFollowupBody(card, hippoDirDisplay),
  ].join('\n');
}

// 她在 TG 回一句时重发一份(卡里已经带了,这是兜底)
export function formatFollowupText(card, hippoDirDisplay = DEFAULT_HIPPO_DIR) {
  return [
    '条子拿好,整段复制,发给隔壁随便哪个大个子:',
    '',
    hippoFollowupBody(card, hippoDirDisplay),
    '',
    `—— 我只管叼书,讲课是它们的事。`,
  ].join('\n');
}

// 条子直接拼进卡里,不再等她回一句 —— 她每天都会去问,多一轮往返只是给它机会掉链。
// 单条问题不限字数,所以这里不保证 ≤4096 —— 由 sendTelegramMessage 的 splitForTelegram 兜底拆条。
export function formatBookCardText(card, dateISO, ebookReader = DEFAULT_EBOOK_READER) {
  const [, m, d] = dateISO.split('-');
  const byline = [truncate(card.bookTitle, 40), card.bookAuthor].filter(Boolean).join(' · ');
  return [
    `📖 书堆扭蛋 · ${Number(m)}月${Number(d)}日`,
    '',
    `《${byline}》`,
    '',
    card.body,
    ...(card.quote ? ['', `"${card.quote}"`] : []),
    '',
    `—— ${card.mutter}`,
    '',
    '━━━━━━━━━━',
    ...(card.fallback
      ? ['(今天模型没写成条子,下面这组是兜底的通用问题,不针对这本书。)', '']
      : []),
    '条子拿好,整段复制发给隔壁大个子:',
    '',
    bookFollowupBody(card, ebookReader),
  ].join('\n');
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

const DEFAULT_EBOOK_READER = 'python3 ~/Downloads/sync-bridge/scripts-bin/ebook-query.py read';

// 条子正文:mini 统一读书命令 + 问题清单 + 防编造要求。
// 每天自动推的卡和"再要一次"的回复共用这一份,避免两处漂移。
function bookFollowupBody(card, ebookReader = DEFAULT_EBOOK_READER) {
  const qs = (card.followups ?? []).map((f, i) => `${i + 1}. ${f}`).join('\n');
  const anchor = card.quote ? ` --grep ${shellQuote(card.quote.slice(0, 40))} --context 8` : '';
  const command = `${ebookReader} --book ${shellQuote(card.bookDir)} --chapter 'FULL.md'${anchor}`;
  return [
    '电子书正式消费库只在 mini,不要读取 MacBook 同名目录。请先运行双机统一命令:',
    command,
    `输出路径应以 mini: 开头(书:《${card.bookTitle}》)。读完原文再逐条回答:`,
    '',
    qs,
    '',
    '逐条答,结合原文上下文,别泛泛。能给具体人名、书名、年份、研究名的地方就给;',
    '拿不准的明确标"不确定",不要生造文献——编一条我整份都不用。',
  ].join('\n');
}

// 她在 TG 回一句时重发一份(卡里已经带了,这是兜底)
export function formatBookFollowupText(card, ebookReader = DEFAULT_EBOOK_READER) {
  return [
    '条子拿好,整段复制,发给隔壁随便哪个大个子:',
    '',
    bookFollowupBody(card, ebookReader),
    '',
    `—— 我只管叼书,讲课是它们的事。`,
  ].join('\n');
}
