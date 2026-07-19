import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickMuseumArtwork } from './lib/museum-pick.js';
import { generateMuseumCard, fallbackMuseumCard } from './lib/museum-gen.js';
import { sendTelegramMessage, sendTelegramPhoto, formatMuseumCaption } from './lib/tg-send.js';
import { readJSON, writeJSONAtomic } from './lib/store.js';
import { localDateISO } from './lib/dates.js';

const HISTORY_LIMIT = 90;

export async function runMuseumCard(cfg) {
  const { dataDir, personaPath, todayISO, rng = Math.random, fetchImpl = fetch } = cfg;
  const gen = cfg.museumGen ?? generateMuseumCard;
  const pick = cfg.museumPick ?? pickMuseumArtwork;
  const sendPhoto = cfg.sendPhotoImpl ?? sendTelegramPhoto;
  const sendText = cfg.sendTextImpl ?? sendTelegramMessage;

  const historyFile = join(dataDir, 'museum-history.json');
  const history = await readJSON(historyFile, []);
  const artwork = await pick({ history, rng, fetchImpl });
  if (!artwork) throw new Error('museum-card: nothing to pick');

  const persona = await readFile(personaPath, 'utf8');
  const g = (await gen({ persona, artwork })) ?? fallbackMuseumCard(artwork, rng);

  const card = {
    date: todayISO,
    artworkId: artwork.id,
    artworkTitle: artwork.title,
    artist: artwork.artist,
    dateDisplay: artwork.dateDisplay,
    color: artwork.color,
    imageUrl: artwork.imageUrl,
    museumUrl: artwork.museumUrl,
    title: g.cardTitle,
    body: g.cardBody,
    followups: g.followups,
    mutter: g.mutter,
    source: 'museum',
  };
  await writeJSONAtomic(join(dataDir, 'museum-cards', `${todayISO}.json`), card);
  await writeJSONAtomic(historyFile, [...history, artwork.id].slice(-HISTORY_LIMIT));

  const tg = await readJSON(join(dataDir, 'tg.json'), null);
  if (!tg?.token || !tg?.chatId) return { ...card, delivered: 'none' };

  const caption = formatMuseumCaption(card, todayISO);
  try {
    await sendPhoto({ token: tg.token, chatId: tg.chatId, photo: card.imageUrl, caption });
    return { ...card, delivered: 'tg-photo' };
  } catch {
    // 图叼不动不空手:降级纯文本附图链接
    await sendText({ token: tg.token, chatId: tg.chatId, text: `${caption}\n\n(图今天叼不动,自己点:${card.imageUrl})` });
    return { ...card, delivered: 'tg-text' };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const claudeBin = process.env.COBBLER_CLAUDE_BIN;
  runMuseumCard({
    dataDir: new URL('./data', import.meta.url).pathname,
    personaPath: new URL('./persona.md', import.meta.url).pathname,
    todayISO: localDateISO(),
    ...(claudeBin ? { museumGen: (input) => generateMuseumCard(input, { claudeBin }) } : {}),
  }).then(
    (c) => { console.log(`[cobbler-museum] ok artwork="${c.artworkTitle}" delivered=${c.delivered}`); },
    (e) => { console.error('[cobbler-museum] fail', e); process.exitCode = 1; },
  );
}
