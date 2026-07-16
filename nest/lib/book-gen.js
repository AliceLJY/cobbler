import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { truncate } from './templates.js';
import { claudePrintArgs, parseClaudeJSON, UNTRUSTED_SOURCE_NOTICE } from './claude-gen.js';

const pexec = promisify(execFile);

export function buildBookPrompt({ persona, book, excerpt }) {
  return [
    persona,
    '',
    '今天中午是"书堆扭蛋"时间:她攒了三百多本中外的书在库里,大多买了没读完。',
    '你每天从书堆里叼一本,翻到中间随便一段,讲给她听——不劝学,就是让她尝一口这本书的味道。',
    UNTRUSTED_SOURCE_NOTICE,
    `今天叼到的一本:《${book.title}》${book.author ? `,作者 ${book.author}` : ''}`,
    '翻到的一段(节选,可能从半句开始):',
    '---',
    excerpt,
    '---',
    '',
    '请写:',
    '- cardTitle: 一句点名这段在讲什么(≤30字,别只抄书名)',
    '- cardBody: 用你自己的话讲这段最值得讲的一个点:它说了什么、妙在哪或者刺在哪(≤140字)',
    '- quote: 从上面节选里原样抄一句最有味道的原文(≤80字,一字不改,必须能在节选里找到)',
    '- followups: 数组,恰好 2 条。她想深挖时值得拿去问"隔壁大 bot"的具体问题(每条≤50字,具体到这本书或这段,别泛泛)',
    '- mutter: 你的一句嘟囔(≤40字)',
    '只输出一个 JSON 对象:{"cardTitle":"...","cardBody":"...","quote":"...","followups":["...","..."],"mutter":"..."}',
  ].join('\n');
}

export async function generateBookCard(input, opts = {}) {
  const {
    claudeBin = `${process.env.HOME}/.local/bin/claude`,
    execImpl = pexec,
    timeoutMs = 120000,
  } = opts;
  let raw;
  try {
    const { stdout } = await execImpl(claudeBin, claudePrintArgs(buildBookPrompt(input)), {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    raw = parseClaudeJSON(stdout);
  } catch { return null; }
  if (!raw) return null;
  for (const k of ['cardTitle', 'cardBody', 'mutter']) {
    if (typeof raw[k] !== 'string' || !raw[k].trim()) return null;
  }
  if (!Array.isArray(raw.followups) || raw.followups.length < 1 || raw.followups.some((f) => typeof f !== 'string' || !f.trim())) return null;
  // 引文防伪:quote 必须原样出现在节选里,不是就丢弃(卡照发,不带引文)
  let quote = typeof raw.quote === 'string' && raw.quote.trim() ? raw.quote.trim() : null;
  if (quote && !input.excerpt.includes(quote)) quote = null;
  return {
    cardTitle: truncate(raw.cardTitle.trim(), 30),
    cardBody: truncate(raw.cardBody.trim(), 140),
    quote: quote ? truncate(quote, 80) : null,
    followups: raw.followups.slice(0, 2).map((f) => truncate(f.trim(), 50)),
    mutter: truncate(raw.mutter.trim(), 40),
  };
}

const FALLBACK_FOLLOWUPS = [
  '这本书的核心论点是什么,作者用什么证据撑起来的',
  '这本书这些年被批评最多的是哪一点,站得住吗',
];

const FALLBACK_MUTTERS = [
  '这本你买的时候说要读。我先替你读了一段。',
  '书不催人。我催。',
  '三百多本里叼一本,爪子没抖。',
];

export function fallbackBookCard(book, excerpt, rng = Math.random) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const firstSentence = (excerpt.split(/[。!?.!?\n]/).find((s) => s.trim().length > 10) ?? excerpt).trim();
  return {
    cardTitle: truncate(book.title, 30),
    cardBody: truncate(`${book.author ?? '佚名'}。今天翻到中间一段,引文自己尝。`, 140),
    quote: truncate(firstSentence, 80),
    followups: [...FALLBACK_FOLLOWUPS],
    mutter: pick(FALLBACK_MUTTERS),
  };
}
