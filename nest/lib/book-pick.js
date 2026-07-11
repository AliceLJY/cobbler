import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

// 书库两代摄入并存:新管线有 chapters/ 子目录,老管线只有 FULL.md——
// 统一从 FULL.md 抽随机窗口,绕开两代差异。metadata.json 的 title/author 两代都干净。
const WINDOW_SIZE = 8000; // 节选窗口字符数
const START_RATIO = 0.15; // 避开开头版权/目录/序言营销
const END_RATIO = 0.9; // 避开结尾索引/版权页

export async function listBooks(ebooksRoot) {
  let names = [];
  try { names = await readdir(ebooksRoot); } catch { return []; }
  const books = [];
  for (const dir of names) {
    try {
      const meta = JSON.parse(await readFile(join(ebooksRoot, dir, 'metadata.json'), 'utf8'));
      if (!meta?.title) continue;
      const full = join(ebooksRoot, dir, 'FULL.md');
      const st = await stat(full);
      if (!st.isFile() || st.size < 5000) continue; // 太小的是残次摄入
      books.push({ dir, title: String(meta.title), author: meta.author ? String(meta.author) : null, fullPath: full, size: st.size });
    } catch { /* 无 metadata/无 FULL.md 的残次目录,跳过 */ }
  }
  return books;
}

export function pickBook(books, history, rng = Math.random) {
  const seen = new Set(history);
  const fresh = books.filter((b) => !seen.has(b.dir));
  const pool = fresh.length ? fresh : books; // 全撞历史放开重复,永不空手
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}

// 从全书文本里取一个段落对齐的随机窗口
export function pickExcerpt(fullText, rng = Math.random, { windowSize = WINDOW_SIZE, startRatio = START_RATIO, endRatio = END_RATIO } = {}) {
  if (fullText.length <= windowSize * 2) return fullText.trim();
  const lo = Math.floor(fullText.length * startRatio);
  const hi = Math.max(lo, Math.floor(fullText.length * endRatio) - windowSize);
  let start = lo + Math.floor(rng() * (hi - lo + 1));
  const paraBreak = fullText.indexOf('\n\n', start);
  if (paraBreak !== -1 && paraBreak < start + windowSize / 2) start = paraBreak + 2;
  return fullText.slice(start, start + windowSize).trim();
}

export async function pickBookExcerpt({ ebooksRoot, history = [], rng = Math.random } = {}) {
  const books = await listBooks(ebooksRoot);
  if (!books.length) throw new Error(`book-pick: no books under ${ebooksRoot}`);
  const book = pickBook(books, history, rng);
  if (!book) return null;
  const fullText = await readFile(book.fullPath, 'utf8');
  return { book, excerpt: pickExcerpt(fullText, rng) };
}
