// 产出回捞（2026-10-31 立）：AI产出 里 README 写着「等 Alice」的批次只有写没有读，
// 两张 ideation-map 停在「等她选」就没下文。这里把 README 的状态行读成一个池，供 output-card.js 抽。
// 状态行约定（shared-behaviors §3，CC 写、不是 Alice 写）：
//   状态: 等Alice ｜ 她要做的一句话        ← 进池
//   状态: 已完成 / 已放弃 / 可清 / 进行中     ← 不进池
// 允许 **状态**、全角冒号、｜ 或 |；只认第一条匹配行。
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const STATUS_RE = /^\s*\**状态\**\s*[:：]\s*(等Alice|已完成|已放弃|可清|进行中)\s*(?:[｜|]\s*(.*?))?\s*$/;
const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})/;

export function parseStatus(readme) {
  for (const line of readme.split('\n')) {
    const m = line.match(STATUS_RE);
    if (m) return { status: m[1], note: (m[2] ?? '').trim() };
  }
  return null;
}

export function batchDate(dir) {
  const m = dir.match(DATE_PREFIX_RE);
  return m ? m[1] : null;
}

export function daysBetween(fromISO, toISO) {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86400000);
}

// 列出 outputDir 下带状态行的批次；没 README 或没状态行的批次不在列（不是池的一部分，不报错）
export async function listOutputBatches(outputDir) {
  const names = await readdir(outputDir);
  const out = [];
  for (const dir of names.sort()) {
    const date = batchDate(dir);
    if (!date) continue;
    let readme;
    try { readme = await readFile(join(outputDir, dir, 'README.md'), 'utf8'); } catch { continue; }
    const st = parseStatus(readme);
    if (!st) continue;
    out.push({ dir, date, status: st.status, note: st.note });
  }
  return out;
}

// 池文件（output-card-scan.sh 的 TSV：目录\t日期\t状态\t一句话）→ 与 listOutputBatches 同形的数组
export function parsePoolTSV(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [dir, date, status, note = ''] = line.split('\t');
    if (!dir || !date || !status) continue;
    out.push({ dir, date, status, note: note.trim() });
  }
  return out;
}

export function pendingBatches(batches, todayISO, { minAgeDays = 2 } = {}) {
  return batches.filter((b) => b.status === '等Alice' && daysBetween(b.date, todayISO) >= minAgeDays);
}

// 抽法：没抽过的里挑最老的；全抽过一轮就挑上次露面最早的（轮着来，不会连着两天同一张）。
// history: [{ dir, date }]，date 是露面那天。
export function pickOutputBatch(batches, history, todayISO, opts = {}) {
  const pool = pendingBatches(batches, todayISO, opts);
  if (!pool.length) return null;
  const lastShown = new Map();
  for (const h of history) lastShown.set(h.dir, h.date);
  const fresh = pool.filter((b) => !lastShown.has(b.dir)).sort((a, b) => a.date.localeCompare(b.date));
  if (fresh.length) return fresh[0];
  return [...pool].sort((a, b) => lastShown.get(a.dir).localeCompare(lastShown.get(b.dir)) || a.date.localeCompare(b.date))[0];
}
