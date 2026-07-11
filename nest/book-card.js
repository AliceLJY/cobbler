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
  const gen = cfg.bookGen ?? generateBookCard;
  const send = cfg.sendImpl ?? sendTelegramMessage;

  const historyFile = join(dataDir, 'book-history.json');
  const history = await readJSON(historyFile, []);
  const picked = await pickBookExcerpt({ ebooksRoot, history, rng });
  if (!picked) throw new Error('book-card: nothing to pick');
  const { book, excerpt } = picked;

  const persona = await readFile(personaPath, 'utf8');
  const g = (await gen({ persona, book, excerpt })) ?? fallbackBookCard(book, excerpt, rng);

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
