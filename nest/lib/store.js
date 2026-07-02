import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

export async function writeJSONAtomic(file, obj) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(obj, null, 2));
  await rename(tmp, file);
}

export const readState = (d) => readJSON(join(d, 'state.json'), null);
export const writeState = (d, s) => writeJSONAtomic(join(d, 'state.json'), s);
export const writeCard = (d, c) => writeJSONAtomic(join(d, 'cards', `${c.date}.json`), c);
export const readCardByDate = (d, date) => readJSON(join(d, 'cards', `${date}.json`), null);

export async function listCards(dataDir, limit = 30) {
  let names = [];
  try { names = await readdir(join(dataDir, 'cards')); } catch { return []; }
  const dates = names.filter((n) => n.endsWith('.json')).sort().reverse().slice(0, limit);
  const cards = [];
  for (const n of dates) cards.push(await readJSON(join(dataDir, 'cards', n), null));
  return cards.filter(Boolean);
}

export async function appendHeartbeat(dataDir, iso) {
  const file = join(dataDir, 'heartbeats.json');
  const arr = await readJSON(file, []);
  arr.push(iso);
  await writeJSONAtomic(file, arr.slice(-100));
}
