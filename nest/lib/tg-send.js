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
    } catch (e) { lastErr = e; }
    if (i < retries - 1) await sleep(baseDelayMs * 2 ** i);
  }
  throw lastErr;
}

export async function sendTelegramMessage({ token, chatId, text }, opts = {}) {
  if (!token || !chatId) throw new Error('tg-send: missing token/chatId');
  return callTelegram({ token, method: 'sendMessage', body: { chat_id: chatId, text } }, opts);
}

export async function sendTelegramPhoto({ token, chatId, photo, caption }, opts = {}) {
  if (!token || !chatId) throw new Error('tg-send: missing token/chatId');
  return callTelegram({ token, method: 'sendPhoto', body: { chat_id: chatId, photo, caption } }, opts);
}

export function formatHippoCardText(card, dateISO) {
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
    '想深挖?回我一下,我把问题条子写好,你拿去问隔壁大个子。',
  ].join('\n');
}

export function formatFollowupText(card, hippoDirDisplay = '~/Projects/河马项目/hippo-wiki') {
  const qs = (card.followups ?? []).map((f, i) => `${i + 1}. ${f}`).join('\n');
  return [
    '条子拿好,整段复制,发给隔壁随便哪个大个子:',
    '',
    `请读 ${hippoDirDisplay}/wiki/${card.pageFile},给我讲透这页「${card.pageTitle}」,重点回答:`,
    qs,
    '结合我现在的项目说,别泛泛。',
    '',
    `—— 我只管叼书,讲课是它们的事。`,
  ].join('\n');
}

export function formatMuseumCaption(card, dateISO) {
  const [, m, d] = dateISO.split('-');
  const byline = [card.artist, card.dateDisplay].filter(Boolean).join(' · ');
  return [
    `🖼️ 美术馆扭蛋 · ${Number(m)}月${Number(d)}日`,
    '',
    `「${truncate(card.artworkTitle, 60)}」`,
    ...(byline ? [byline] : []),
    '',
    card.body,
    '',
    `—— ${card.mutter}`,
    '',
    '想深挖?回我一下,我把问题条子写好,你拿去问隔壁大个子。',
  ].join('\n');
}

export function formatBookCardText(card, dateISO) {
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
    '想深挖?回我一下,我把问题条子写好,你拿去问隔壁大个子。',
  ].join('\n');
}

export function formatBookFollowupText(card, ebooksDisplay = '~/Downloads/hermes-shared/ebooks/cc-ingested') {
  const qs = (card.followups ?? []).map((f, i) => `${i + 1}. ${f}`).join('\n');
  const anchor = card.quote ? `,先 grep 引文"${card.quote.slice(0, 15)}"定位到我讲的那段` : '';
  return [
    '条子拿好,整段复制,发给隔壁随便哪个大个子:',
    '',
    `请读 ${ebooksDisplay}/${card.bookDir}/FULL.md(书:《${card.bookTitle}》)${anchor},重点回答:`,
    qs,
    '结合上下文讲,别泛泛。',
    '',
    `—— 我只管叼书,讲课是它们的事。`,
  ].join('\n');
}

export function formatMuseumFollowupText(card) {
  const qs = (card.followups ?? []).map((f, i) => `${i + 1}. ${f}`).join('\n');
  const url = card.museumUrl ?? card.articUrl; // articUrl 兼容首日 artic 格式旧卡
  return [
    '条子拿好,整段复制,发给隔壁随便哪个大个子:',
    '',
    `请查一查「${card.artworkTitle}」(${card.artist || '佚名'}),馆藏页 ${url},重点回答:`,
    qs,
    '顺带讲讲这件作品值得知道的背景,别泛泛。',
    '',
    `—— 我只管叼画,讲课是它们的事。`,
  ].join('\n');
}
