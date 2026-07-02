import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROW_RE = /^\|\s*\d+\s*\|\s*(\d{2})-(\d{2})\s*\|/;

export function parseLearningsFile(text, year) {
  const items = [];
  for (const line of text.split('\n')) {
    const m = line.match(ROW_RE);
    if (!m) continue;
    const cells = line.split('|').map((s) => s.trim());
    // ['', '#', 'MM-DD', 来源, 主题..., 分类, ''] — 主题内含 | 时合并中段
    if (cells.length < 6) continue;
    items.push({
      date: `${year}-${m[1]}-${m[2]}`,
      kind: 'learning',
      title: cells[3],
      detail: cells.slice(4, cells.length - 2).join(' | '),
    });
  }
  return items;
}

export async function loadLearnings(dir) {
  let names = [];
  try { names = await readdir(dir); } catch { return []; }
  const files = names.filter((n) => /^\d{4}-\d{2}\.md$/.test(n)).sort();
  const all = [];
  for (const name of files) {
    const year = Number(name.slice(0, 4));
    const text = await readFile(join(dir, name), 'utf8');
    all.push(...parseLearningsFile(text, year));
  }
  return all;
}
