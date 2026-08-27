import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { truncate } from './templates.js';
import { claudePrintArgs, parseClaudeJSON, UNTRUSTED_SOURCE_NOTICE } from './claude-gen.js';

const pexec = promisify(execFile);

export function buildHippoPrompt({ persona, page }) {
  const when = page.date ? `,她 ${page.date} 前后研究过` : '';
  return [
    persona,
    '',
    '今晚是"知识扭蛋"时间:Alice 的研究库 hippo-wiki 里存着几百页她读过、研究过的东西,',
    '你每晚从书堆里叼一页出来,用简单的话讲给她听——不考试,就是让她重逢一下。',
    UNTRUSTED_SOURCE_NOTICE,
    `今晚叼到的一页:「${page.title}」(${page.type}${when})`,
    `这页的摘要:${page.summary}`,
    '',
    '请写:',
    '- cardTitle: 一句点名这页讲的是什么(≤30字)',
    '- cardBody: 简单介绍:它是什么、当时为什么值得她研究,用你自己的话讲,克制但讲清(≤140字)',
    '- followups: 数组,5 到 7 条。这是她要整段复制、拿去问大模型的问题条子——',
    '  她每天都会真的去问,这份条子决定她这一页复习得深不深,所以别敷衍。',
    '  这页是她自己研究过的东西,所以问题要往"还成立吗、能用吗"上打。',
    '  从下面这些角度里挑最能挖出东西的几个,一个角度一条,别都挤在同一类:',
    '  · 证据与出处——这页的判断当时基于什么,来源可靠吗,哪一环最薄弱',
    '  · 时效——这个结论到今天还成立吗,这段时间这个领域发生了什么可能推翻它',
    '  · 反面——什么情况下这条不适用,最强的反对意见长什么样,谁在反对',
    '  · 落地——放到她现在的项目上具体该改哪一处,代价是什么,不改会怎样',
    '  · 关联——和她研究过的别的东西能接上吗,接口在哪,接上以后多出什么能力',
    '  · 盲区——这页当时漏掉了哪个角度,现在补上会改变结论吗',
    '  长度不限——问题该多长就多长,宁可一条写满三行也别为了短砍掉限定条件;',
    '  质疑要写透,这比简洁重要得多——把「你在质疑什么、为什么这构成质疑、',
    '  要推翻它得拿出什么新证据」三层都写出来,一条问题写成一整段话是好的不是缺点。',
    '  宁可七条里有三条各写满一段,也别七条都缩成一句话。',
    '  必须带这页里的具体抓手(名字、概念、数字、时间),',
    '  不许写成"这个到今天还成立吗""和我的项目有什么关系"这种放之四海皆可的空问。',
    '- mutter: 你的一句嘟囔(≤40字)',
    '只输出一个 JSON 对象:{"cardTitle":"...","cardBody":"...","followups":["...","..."],"mutter":"..."}',
  ].join('\n');
}

export async function generateHippoCard(input, opts = {}) {
  const {
    claudeBin = `${process.env.HOME}/.local/bin/claude`,
    execImpl = pexec,
    // 30 分钟 ≈ 不设限:实测生成最长 167s,这里留了 10 倍余量,
    // 正常生成不可能被它砍掉 —— Alice 2026-08-27 明确「不要限制超时都没问题,
    // 当天没收到我自己去后台查」。之所以不写 timeout:0(真·无限),是因为
    // launchd 不并发跑同 label 的 job:一个挂死的进程会让此后每一天都静默不跑,
    // 而她只会看到「今天没收到」,发现不了是永久卡死。30 分钟能自愈,代价为零。
    timeoutMs = 1800000,
  } = opts;
  let raw;
  try {
    const { stdout } = await execImpl(claudeBin, claudePrintArgs(buildHippoPrompt(input)), {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    raw = parseClaudeJSON(stdout);
  } catch { return null; }
  if (!raw) return null;
  for (const k of ['cardTitle', 'cardBody', 'mutter']) {
    if (typeof raw[k] !== 'string' || !raw[k].trim()) return null;
  }
  // 条子是这张卡的主料(她每天整段复制去问大模型),少于 3 条视为没写成,走 fallback
  if (!Array.isArray(raw.followups) || raw.followups.length < 3 || raw.followups.some((f) => typeof f !== 'string' || !f.trim())) return null;
  return {
    cardTitle: truncate(raw.cardTitle.trim(), 30),
    cardBody: truncate(raw.cardBody.trim(), 140),
    // 单条不截断,理由同 book-gen:砍字数等于砍掉限定条件
    followups: raw.followups.slice(0, 8).map((f) => f.trim()),
    mutter: truncate(raw.mutter.trim(), 40),
  };
}

// 兜底条子:模型挂了才用,此时只有页面标题和摘要,只能按角度骨架出通用问题。
// 连续出现说明 claude 调用在挂,去看 hippo.log。
const FALLBACK_FOLLOWUPS = [
  '这页的核心判断当时基于什么证据,哪一环最薄弱',
  '这个结论到今天还成立吗?这段时间这个领域发生了什么可能推翻它',
  '什么情况下这条不适用?最强的反对意见长什么样',
  '放到我现在的项目上具体该改哪一处,代价是什么,不改会怎样',
  '这页当时漏掉了哪个角度,补上会不会改变结论',
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
    fallback: true, // 理由同 book-gen
  };
}
