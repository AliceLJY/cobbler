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
    '你每晚从书堆里叼一页出来,讲给她听,再考她一下。',
    `今晚叼到的一页:「${page.title}」(${page.type}${when})`,
    `这页的摘要:${page.summary}`,
    '',
    '请写:',
    '- cardTitle: 一句点名这页讲的是什么(≤30字)',
    '- cardBody: 用你自己的话把它讲回来给她听,一两句就够,落点克制(≤100字)',
    '- question: 考她一个小问题,让她回忆或者往自己的项目上联想(≤40字)',
    '- mutter: 你的一句嘟囔(≤40字)',
    '只输出一个 JSON 对象:{"cardTitle":"...","cardBody":"...","question":"...","mutter":"..."}',
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
  for (const k of ['cardTitle', 'cardBody', 'question', 'mutter']) {
    if (typeof raw[k] !== 'string' || !raw[k]) return null;
  }
  return {
    cardTitle: truncate(raw.cardTitle, 30),
    cardBody: truncate(raw.cardBody, 100),
    question: truncate(raw.question, 40),
    mutter: truncate(raw.mutter, 40),
  };
}

const FALLBACK_QUESTIONS = [
  '这个你现在还能讲出个大概吗。',
  '它当时解决的是什么问题,还记得吗。',
  '要是现在的项目用得上它,会用在哪。',
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
    cardBody: truncate(page.summary, 100),
    question: pick(FALLBACK_QUESTIONS),
    mutter: pick(FALLBACK_MUTTERS),
  };
}
