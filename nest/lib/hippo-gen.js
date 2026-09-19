import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { truncate } from './templates.js';
import { claudePrintArgs, parseClaudeJSON, UNTRUSTED_SOURCE_NOTICE, FOLLOWUP_JUDGMENT_RULES, FOLLOWUP_BREVITY_RULES,
  clipForLog, describeExecFailure, describeBadCard, describeBadFollowups, describeVoiceLeaks, describeOverlong,
  execClaude, stripFollowupJunk } from './claude-gen.js';

// 条子最多 5 条(2026-09-19 起 3-5 条短问题)。多出来的整条丢掉,单条永不截断。
export const MAX_FOLLOWUPS = 5;

// wiki 双链去壳:[[X]] → X,[[X|Y]] → Y(2026-09-19 加)。
// 喂给模型的正文保持原样(页面里满是双链),模型会把 [[digiton-agent-fleet]] 这种原样抄进问题,
// 发到 TG 是一串方括号噪音。只剥卡上显示的文字,不动喂进去的正文。
export function stripWikilinks(s) {
  return s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
}

const pexec = promisify(execFile);

export function buildHippoPrompt({ persona, page }) {
  const when = page.date ? `,她 ${page.date} 前后研究过` : '';
  // 回访事实(2026-09-14 加):三态,缺字段时整句不出现 —— 判不了就别说,别让模型
  // 把「不知道」读成「没回访过」。'never' 是记录上的事实(created===updated),不是推测。
  // 措辞只说记录能证明的(2026-09-17 改):原写「一个字没改过」,比记录能证明的多——
  // ideation-map 页 08-20 有过一次批量去链接的机械编辑(没动 updated),卡片照抄这句发给她,是假话。
  const revisit = page.revisited === 'never'
    ? '这页建立后没有登记过回访修订(frontmatter 的 updated 仍停在建立当天)——她此后没有回过头核验它的内容。'
      + '(这是记录上的事实,不是推测;但它不等于一个字都没动过,别写成「一个字没改过」;'
      + '**未核验 ≠ 已过期**,别替她下结论说它凉了)'
    : (page.revisited ? `这页 ${page.revisited} 被回访修订过一次。` : '');
  return [
    persona,
    '',
    '今晚是"知识扭蛋"时间:Alice 的本地知识库里存着几百页她读过、研究过的东西,',
    '你每晚从书堆里叼一页出来,用简单的话讲给她听——不考试,就是让她重逢一下。',
    UNTRUSTED_SOURCE_NOTICE,
    `今晚叼到的一页:「${page.title}」(${page.type}${when})`,
    ...(revisit ? [revisit] : []),
    `这页的摘要:${page.summary}`,
    // 正文(2026-09-19 加):此前模型只拿到上面那句摘要。09-19 抽中「openspec-plus 借鉴审计」,
    // 摘要是 419 / 3,719 字的导语 + 首段,判决、采纳表、「已覆盖」清单都不在里面,条子于是在
    // 页面已经回答过的地方打转,还把「零代码」猜成了影响判断的理由(三条拒因里没有它)。
    ...(page.excerpt ? ['这页正文(让你知道它已经说了什么、当时下了什么判断):', '---', page.excerpt, '---'] : []),
    '',
    '请写:',
    '- cardTitle: 一句点名这页讲的是什么(≤30字)',
    '- cardBody: 简单介绍:它是什么、当时为什么值得她研究,用你自己的话讲,克制但讲清(≤140字)',
    `- followups: 数组,3 到 ${MAX_FOLLOWUPS} 条。这是她要整段复制、拿去问大模型的问题条子——`,
    '  她每天都会真的去问,所以别敷衍。这页是她自己研究过的东西,问题要往"还成立吗、能用吗"上打。',
    '  从下面这些角度里挑最能挖出东西的几个,一个角度一条,别都挤在同一类:',
    '  · 证据与出处——这页的判断当时基于什么,哪一环最薄弱',
    '  · 时效——页面里若有会变的具体断言(版本、产品状态、评测口径、实施前提),挑一条问它今天还成不成立。',
    '    **别因为页子旧就预设结论已过期**;页面里没有的数字和细节不要补造。上面若写了"没有登记过回访修订",',
    '    那是记录上的事实,可以据此问该怎么核对它,但仍然不许替她断言它已经凉了',
    '  · 反面——点出这条最可能在哪个前提上站不住;反对意见本身留给她去问',
    '  · 落地——放到她现在的项目上会动哪一处',
    '  · 关联——和她研究过的别的东西能不能接上',
    '  · 盲区——这页只讲了哪一面,范围外还该看什么',
    '  正文里已经回答过的问题别原样再问;要问就问它今天还成不成立,或者正文没碰到的地方。',
    ...FOLLOWUP_BREVITY_RULES,
    ...FOLLOWUP_JUDGMENT_RULES,
    '  必须带这页里的具体抓手(名字、概念、数字、时间),',
    '  不许写成"这个到今天还成立吗""和我的项目有什么关系"这种放之四海皆可的空问。',
    '- mutter: 你的一句嘟囔(≤40字)',
    '只输出一个 JSON 对象:{"cardTitle":"...","cardBody":"...","followups":["...","..."],"mutter":"..."}',
  ].join('\n');
}

// 重试一次再兜底,理由同 book-gen(模型偶发写坏 followups 结构 / 调用瞬时故障)。
export async function generateHippoCard(input, opts = {}) {
  const { attempts = 2, onFail, ...rest } = opts;
  for (let i = 1; i <= attempts; i += 1) {
    const isLast = i === attempts;
    const card = await generateHippoCardOnce(input, {
      ...rest,
      onFail: (m) => onFail?.(isLast ? m : `${m} [第 ${i}/${attempts} 次,重试]`),
    });
    if (card) return card;
  }
  return null;
}

async function generateHippoCardOnce(input, opts = {}) {
  const {
    claudeBin = `${process.env.HOME}/.local/bin/claude`,
    execImpl = pexec,
    // 30 分钟 ≈ 不设限:实测生成最长 167s,这里留了 10 倍余量,
    // 正常生成不可能被它砍掉 —— Alice 2026-08-27 明确「不要限制超时都没问题,
    // 当天没收到我自己去后台查」。之所以不写 timeout:0(真·无限),是因为
    // launchd 不并发跑同 label 的 job:一个挂死的进程会让此后每一天都静默不跑,
    // 而她只会看到「今天没收到」,发现不了是永久卡死。30 分钟能自愈,代价为零。
    timeoutMs = 1800000,
    onFail,
    onNote,
  } = opts;
  let raw;
  try {
    const { stdout } = await execClaude(execImpl, claudeBin, claudePrintArgs(buildHippoPrompt(input)), {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    let parseErr = null;
    raw = parseClaudeJSON(stdout, (e) => { parseErr = e; });
    if (!raw) onFail?.(`[hippo] 输出里没有可解析 JSON: ${parseErr} | 原样:${clipForLog(stdout)}`);
  } catch (err) {
    onFail?.(`[hippo] claude 调用失败: ${describeExecFailure(err)}`);
    return null;
  }
  if (!raw) return null;
  const badCard = describeBadCard(raw, ['cardTitle', 'cardBody', 'mutter']);
  if (badCard) { onFail?.(`[hippo] 卡片不合格: ${badCard}`); return null; }
  // 条子是这张卡的主料(她每天整段复制去问大模型),少于 3 条视为没写成,走 fallback
  // 先摘掉模型插进数组的占位残留,再判够不够 3 条 —— 残留不该算进条数,更不该发出去。
  const { clean: followups, dropped } = stripFollowupJunk(raw.followups);
  if (dropped.length) onNote?.(`[hippo] 丢弃 ${dropped.length} 条模型占位残留: ${clipForLog(JSON.stringify(dropped))}`);
  const badFollowups = describeBadFollowups(followups);
  if (badFollowups) { onFail?.(`[hippo] 条子没写成: ${badFollowups}`); return null; }
  const kept = followups.slice(0, MAX_FOLLOWUPS).map((f) => stripWikilinks(f.trim()));
  // 影子期检查(2026-09-19):只写日志,不拦、不重试——拦下来只能走兜底通用问题,比漏一条更糟。
  const leaks = describeVoiceLeaks(kept);
  if (leaks.length) onNote?.(`[hippo] 口吻检查(影子期,只记录): ${leaks.join(' / ')}`);
  const overlong = describeOverlong(kept);
  if (overlong.length) onNote?.(`[hippo] 写短检查(影子期,只记录): ${overlong.join(' / ')}`);
  return {
    cardTitle: truncate(stripWikilinks(raw.cardTitle.trim()), 30),
    cardBody: truncate(stripWikilinks(raw.cardBody.trim()), 140),
    // 单条不截断,理由同 book-gen:砍字数等于砍掉限定条件(写短靠 prompt,不靠截断)
    followups: kept,
    mutter: truncate(stripWikilinks(raw.mutter.trim()), 40),
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
