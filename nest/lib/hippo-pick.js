import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SCAN_DIRS = ['concepts', 'entities', 'sources'];
const DIR_TYPE = { concepts: 'concept', entities: 'entity', sources: 'source' };
const EXCLUDE = new Set(['_index.md', 'CLAUDE.md']);

export function parseFrontmatter(raw) {
  const out = {};
  if (!raw.startsWith('---')) return out;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return out;
  for (const line of raw.slice(3, end).split('\n')) {
    const m = line.match(/^(title|type|created|updated):\s*(.+)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

export function extractSummary(raw) {
  const lines = raw.split('\n');
  const i = lines.findIndex((l) => l.includes('[!summary]') || l.includes('[!info]'));
  if (i !== -1) {
    const buf = [];
    for (let j = i + 1; j < lines.length && lines[j].startsWith('>'); j++) {
      buf.push(lines[j].replace(/^>\s?/, ''));
    }
    const s = buf.join(' ').trim();
    if (s) return s;
  }
  // 兜底:frontmatter 之后第一个正文段落
  let body = raw;
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end !== -1) body = raw.slice(end + 4);
  }
  for (const l of body.split('\n')) {
    const t = l.trim();
    if (t && !t.startsWith('#') && !t.startsWith('>') && !t.startsWith('|') && !t.startsWith('---')) return t;
  }
  return '';
}

export function parsePage(raw, fileName, dir) {
  const fm = parseFrontmatter(raw);
  return {
    file: `${dir}/${fileName}`,
    dir,
    title: fm.title || fileName.replace(/\.md$/, ''),
    type: fm.type || DIR_TYPE[dir] || dir,
    // created 优先：prompt 里这个值会被说成「她 X 前后研究过」，而 updated 是页面
    // 最后编辑日（复核一次就会盖掉原研究日），拿它当研究时间会对模型撒谎。
    date: fm.created || fm.updated || null,
    // 这页建立之后有没有被回访过（2026-09-14 加）。
    // 缘由：09-13 扭蛋抽中 2026-04 建的「Garry Tan」页，卡片照四月记录讲「GBrain 是
    // 10K 文件的个人知识大脑」，而它当时早已是 15 万页的 agent brain——**卡片不知道
    // 自己叼出来的是化石**。prompt 里那句「日期只是页面记录时间、不代表最后核验时间」
    // 写得没错，但那是因为它**确实不知道**；给它这个字段，「不知道」就变成了可判断的事实。
    // 三态，别塌成布尔：null = 缺字段判不了（≠「没回访过」，不许当未回访报）。
    revisited: (fm.created && fm.updated)
      ? (fm.created === fm.updated ? 'never' : fm.updated)
      : null,
    summary: extractSummary(raw),
  };
}

export async function listHippoPages(hippoDir) {
  const pages = [];
  for (const dir of SCAN_DIRS) {
    let names = [];
    try { names = await readdir(join(hippoDir, 'wiki', dir)); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.md') || EXCLUDE.has(n)) continue;
      try {
        const raw = await readFile(join(hippoDir, 'wiki', dir, n), 'utf8');
        pages.push(parsePage(raw, n, dir));
      } catch { /* 单页读失败不挡整体 */ }
    }
  }
  return pages;
}

export function pickHippoPage(pages, history, rng = Math.random) {
  const seen = new Set(history);
  const fresh = pages.filter((p) => !seen.has(p.file) && p.summary);
  const pool = fresh.length ? fresh : pages.filter((p) => p.summary);
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}
