import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { truncate } from './templates.js';
import { parseClaudeJSON } from './claude-gen.js';

const pexec = promisify(execFile);

export function buildHippoPrompt({ persona, page }) {
  const when = page.date ? `,她 ${page.date} 前后研究过` : '';
  return [
    persona,
    '',
    '今晚是"知识扭蛋"时间:Alice 的研究库 hippo-wiki 里存着几百页她读过、研究过的东西,',
    '你每晚从书堆里叼一页出来,用简单的话讲给她听——不考试,就是让她重逢一下。',
    `今晚叼到的一页:「${page.title}」(${page.type}${when})`,
    `这页的摘要:${page.summary}`,
    '',
    '请写:',
    '- cardTitle: 一句点名这页讲的是什么(≤30字)',
    '- cardBody: 简单介绍:它是什么、当时为什么值得她研究,用你自己的话讲,克制但讲清(≤140字)',
    '- followups: 数组,恰好 2 条。如果她想深挖,值得拿去问"隔壁大 bot"的具体问题(每条≤50字,要具体到这页的内容,别泛泛)',
    '- mutter: 你的一句嘟囔(≤40字)',
    '只输出一个 JSON 对象:{"cardTitle":"...","cardBody":"...","followups":["...","..."],"mutter":"..."}',
  ].join('\n');
}

export async function generateHippoCard(input, opts = {}) {
  const {
    claudeBin = `${process.env.HOME}/.local/bin/claude`,
    execImpl = pexec,
    timeoutMs = 120000,
  } = opts;
  let raw;
  try {
    const { stdout } = await execImpl(claudeBin, ['-p', buildHippoPrompt(input)], {
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
  '这页的核心判断放到今天还成立吗,依据是什么',
  '这个东西和我现在的项目有哪些能接上的点',
];

const FALLBACK_MUTTERS = [
  '书堆比你想的深。我随手一叼就是你忘了的。',
  '你存的时候说以后有用。以后就是今天。',
  '水烧开的功夫,我又翻完一页。',
];

export function fallbackHippoCard(page, rng = Math.random) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return {
    cardTitle: truncate(page.title, 30),
    cardBody: truncate(page.summary, 140),
    followups: [...FALLBACK_FOLLOWUPS],
    mutter: pick(FALLBACK_MUTTERS),
  };
}
