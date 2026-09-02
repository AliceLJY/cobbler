import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickBookExcerpt } from './lib/book-pick.js';
import { generateBookCard, fallbackBookCard } from './lib/book-gen.js';
import { sendTelegramMessage, formatBookCardText } from './lib/tg-send.js';
import { readJSON, writeJSONAtomic } from './lib/store.js';
import { localDateISO } from './lib/dates.js';

const HISTORY_LIMIT = 90;

export async function runBookCard(cfg) {
  const { ebooksRoot, dataDir, personaPath, todayISO, rng = Math.random } = cfg;
  // log 提到 gen 之前:gen 的默认实现要把降级原因写进同一份日志
  const log = cfg.log ?? console.error;
  const gen = cfg.bookGen ?? ((input) => generateBookCard(input, { onFail: log, onNote: log }));
  const send = cfg.sendImpl ?? sendTelegramMessage;

  const historyFile = join(dataDir, 'book-history.json');
  const history = await readJSON(historyFile, []);
  const picked = await pickBookExcerpt({ ebooksRoot, history, rng });
  if (!picked) throw new Error('book-card: nothing to pick');
  const { book, excerpt } = picked;

  const persona = await readFile(personaPath, 'utf8');
  // 降级要留痕:fallback 卡长得跟正常卡一样(也有一组条子),静默降级她看不出来。
  // 日志里出现 FALLBACK = 重试后仍没写成。它前面有 1~2 行原因:带 [第 1/2 次,重试]
  // 的是第一次尝试,不带的那行才是最终降级原因。原因分三类,各自都能自己说清:
  //   调用失败      → exit= / stdout= / stderr= 三处全留(别只信 stderr,那里有常驻 warning)
  //   JSON 解析失败 → 带 position N 和坏点附近原文(模型常写到 followups 中途跳出数组语法)
  //   卡片/条子不合格 → 指名哪个字段空了、条子只有几条
  let g = await gen({ persona, book, excerpt });
  if (!g) { log('[cobbler-book] FALLBACK 模型没出条子,降级到通用问题'); g = fallbackBookCard(book, excerpt, rng); }

  const card = {
    date: todayISO,
    bookTitle: book.title,
    bookAuthor: book.author,
    bookDir: book.dir,
    title: g.cardTitle,
    body: g.cardBody,
    quote: g.quote,
    followups: g.followups,
    mutter: g.mutter,
    source: 'book',
    ...(g.fallback ? { fallback: true } : {}),
  };
  await writeJSONAtomic(join(dataDir, 'book-cards', `${todayISO}.json`), card);
  await writeJSONAtomic(historyFile, [...history, book.dir].slice(-HISTORY_LIMIT));

  const tg = await readJSON(join(dataDir, 'tg.json'), null);
  if (tg?.token && tg?.chatId) {
    await send({ token: tg.token, chatId: tg.chatId, text: formatBookCardText(card, todayISO) });
    return { ...card, delivered: 'tg' };
  }
  return { ...card, delivered: 'none' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const HOME = process.env.HOME;
  const claudeBin = process.env.COBBLER_CLAUDE_BIN;
  runBookCard({
    ebooksRoot: process.env.COBBLER_EBOOKS_DIR ?? `${HOME}/Downloads/hermes-shared/ebooks/cc-ingested`,
    dataDir: new URL('./data', import.meta.url).pathname,
    personaPath: new URL('./persona.md', import.meta.url).pathname,
    todayISO: localDateISO(),
    ...(claudeBin ? { bookGen: (input) => generateBookCard(input, { claudeBin }) } : {}),
  }).then(
    (c) => { console.log(`[cobbler-book] ok book="${c.bookTitle}" delivered=${c.delivered}`); },
    (e) => { console.error('[cobbler-book] fail', e); process.exitCode = 1; },
  );
}
