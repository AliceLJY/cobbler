import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { truncate } from './templates.js';
import { parseClaudeJSON } from './claude-gen.js';

const pexec = promisify(execFile);

// artic 的 artist_display 常带换行(作者名\n流派/地点),压成一行
export const cleanDisplay = (s) => (s ?? '').replace(/\s*\n\s*/g, ' · ').trim();

export function buildMuseumPrompt({ persona, artwork }) {
  const who = artwork.artist || '佚名';
  const lines = [
    persona,
    '',
    '今早是"美术馆扭蛋"时间:大都会艺术博物馆把几十万件公版馆藏开放了出来,',
    '你每天从里面叼一件回来,用简单的话讲给她听——不上课,就是让她睁眼看见一件好东西。',
    `今天叼到的一件:「${artwork.title}」`,
    `作者:${who}${artwork.dateDisplay ? `(${artwork.dateDisplay})` : ''}`,
  ];
  if (artwork.medium) lines.push(`材质:${artwork.medium}`);
  if (artwork.origin) lines.push(`产地/文化:${artwork.origin}`);
  if (artwork.color) lines.push(`馆方标注的主色:hsl(${artwork.color.h}, ${artwork.color.s}%, ${artwork.color.l}%)`);
  lines.push(
    '',
    '请写:',
    '- cardTitle: 一句点名这是件什么东西(≤30字)',
    '- cardBody: 讲讲它:是什么、好看或有意思在哪,用你自己的话,克制但讲清(≤140字)',
    '- followups: 数组,恰好 2 条。她想深挖时值得拿去问"隔壁大 bot"的具体问题(每条≤50字,具体到这件作品或作者,别泛泛)',
    '- mutter: 你的一句嘟囔(≤40字)',
    '只输出一个 JSON 对象:{"cardTitle":"...","cardBody":"...","followups":["...","..."],"mutter":"..."}',
  );
  return lines.join('\n');
}

export async function generateMuseumCard(input, opts = {}) {
  const {
    claudeBin = `${process.env.HOME}/.local/bin/claude`,
    execImpl = pexec,
    timeoutMs = 120000,
  } = opts;
  let raw;
  try {
    const { stdout } = await execImpl(claudeBin, ['-p', buildMuseumPrompt(input)], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    raw = parseClaudeJSON(stdout);
  } catch { return null; }
  if (!raw) return null;
  for (const k of ['cardTitle', 'cardBody', 'mutter']) {
    if (typeof raw[k] !== 'string' || !raw[k]) return null;
  }
  if (!Array.isArray(raw.followups) || raw.followups.length < 1 || raw.followups.some((f) => typeof f !== 'string' || !f)) return null;
  return {
    cardTitle: truncate(raw.cardTitle, 30),
    cardBody: truncate(raw.cardBody, 140),
    followups: raw.followups.slice(0, 2).map((f) => truncate(f, 50)),
    mutter: truncate(raw.mutter, 40),
  };
}

const FALLBACK_FOLLOWUPS = [
  '这位作者(或这个文明)还有什么代表作,放在一起看是什么脉络',
  '这件东西的年代和产地,当时正发生什么',
];

const FALLBACK_MUTTERS = [
  '美术馆闭馆了。我出来的时候顺了一件。',
  '你看画三秒。我把它叼回来走了三条街。',
  '挂在墙上是艺术,叼在嘴里是今天的卡。',
];

export function fallbackMuseumCard(artwork, rng = Math.random) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const who = artwork.artist || '佚名';
  const bits = [who, artwork.dateDisplay, artwork.medium, artwork.origin].filter(Boolean);
  return {
    cardTitle: truncate(artwork.title, 30),
    cardBody: truncate(bits.join(' · '), 140),
    followups: [...FALLBACK_FOLLOWUPS],
    mutter: pick(FALLBACK_MUTTERS),
  };
}
