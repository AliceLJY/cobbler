import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { truncate } from './templates.js';
import { claudePrintArgs, parseClaudeJSON, UNTRUSTED_SOURCE_NOTICE, clipForLog,
  describeExecFailure, describeBadCard, describeBadFollowups, execClaude } from './claude-gen.js';

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
    '- followups: 数组,5 到 7 条。这是她要整段复制、拿去问大模型的问题条子——',
    '  她每天都会真的去问,这份条子决定她这本书读得深不深,所以别敷衍。',
    '  从下面这些角度里挑最能挖出东西的几个,一个角度一条,别都挤在同一类:',
    '  · 证据链——这个论点靠哪几类材料撑起来,哪一环最薄弱',
    '  · 反证与边界——什么情况下它会失效,有没有反例(别的社会、别的时期、别的人群)',
    '  · 因果强度——从"两件事同时出现"到"这个导致那个"这一步怎么完成的,有没有共同的第三因',
    '  · 传导机制——从 A 到 B 中间被跳过的环节是什么(制度、技术、行业、法律、市场)',
    '  · 谱系与对手——这个说法承接自谁,作者相对前人新增了什么,学界谁反对、反对哪一点',
    '  · 落点——放到今天、放到中文语境是什么位置,最不能直接搬的是哪一点',
    '  · 元问题——有没有过度解释的风险,最强的反方论证长什么样',
    '  长度不限——问题该多长就多长,宁可一条写满三行也别为了短砍掉限定条件;',
    '  质疑要写透,这比简洁重要得多——把「你在质疑什么、为什么这构成质疑、',
    '  要推翻它得拿出什么新证据」三层都写出来,一条问题写成一整段话是好的不是缺点。',
    '  宁可七条里有三条各写满一段,也别七条都缩成一句话。',
    '  必须带这本书里的具体抓手(人名、概念、案例、年代、地名),',
    '  不许写成"这本书核心论点是什么""这本书被批评最多的是哪点"这种放之四海皆可的空问。',
    '- mutter: 你的一句嘟囔(≤40字)',
    '只输出一个 JSON 对象:{"cardTitle":"...","cardBody":"...","quote":"...","followups":["...","..."],"mutter":"..."}',
  ].join('\n');
}

// 降级不是只能认命:2026-09-02 实测,真实书库素材下模型约每三次就有一次把 followups
// 数组的结构写坏(在数组里写成 "2":"..." 这种键值对),JSON 解析当场失败;而当天 12:30
// 那次调用失败,07:30 和当晚手动跑都正常,是瞬时故障。两类都是"再来一次大概率就好"。
// 所以先重试一次再谈兜底 —— 兜底卡对她是废品,多花的一分钟只在失败时才付。
// 重试一样失败才降级,行为与改造前一致。
export async function generateBookCard(input, opts = {}) {
  const { attempts = 2, onFail, ...rest } = opts;
  for (let i = 1; i <= attempts; i += 1) {
    const isLast = i === attempts;
    // 非最后一次的失败也要留痕,否则重试会把"第一次为什么失败"这个信息吞掉。
    const card = await generateBookCardOnce(input, {
      ...rest,
      onFail: (m) => onFail?.(isLast ? m : `${m} [第 ${i}/${attempts} 次,重试]`),
    });
    if (card) return card;
  }
  return null;
}

async function generateBookCardOnce(input, opts = {}) {
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
  } = opts;
  let raw;
  try {
    const { stdout } = await execClaude(execImpl, claudeBin, claudePrintArgs(buildBookPrompt(input)), {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    let parseErr = null;
    raw = parseClaudeJSON(stdout, (e) => { parseErr = e; });
    if (!raw) onFail?.(`[book] 输出里没有可解析 JSON: ${parseErr} | 原样:${clipForLog(stdout)}`);
  } catch (err) {
    onFail?.(`[book] claude 调用失败: ${describeExecFailure(err)}`);
    return null;
  }
  if (!raw) return null;
  const badCard = describeBadCard(raw, ['cardTitle', 'cardBody', 'mutter']);
  if (badCard) { onFail?.(`[book] 卡片不合格: ${badCard}`); return null; }
  // 条子是这张卡的主料(她每天整段复制去问大模型),少于 3 条视为没写成,走 fallback
  const badFollowups = describeBadFollowups(raw.followups);
  if (badFollowups) { onFail?.(`[book] 条子没写成: ${badFollowups}`); return null; }
  // 引文防伪:quote 必须原样出现在节选里,不是就丢弃(卡照发,不带引文)
  let quote = typeof raw.quote === 'string' && raw.quote.trim() ? raw.quote.trim() : null;
  if (quote && !input.excerpt.includes(quote)) quote = null;
  return {
    cardTitle: truncate(raw.cardTitle.trim(), 30),
    cardBody: truncate(raw.cardBody.trim(), 140),
    quote: quote ? truncate(quote, 80) : null,
    // 单条不截断:她要的是"有分量"的问题,砍字数等于砍掉限定条件(2026-08-27 她的要求)。
    // 超 Telegram 4096 由 sendTelegramMessage 拆条兜底,不在这里丢内容。
    followups: raw.followups.slice(0, 8).map((f) => f.trim()),
    mutter: truncate(raw.mutter.trim(), 40),
  };
}

// 兜底条子:模型挂了才用,此时只有书名没有内容,只能按角度骨架出通用问题。
// 比不发强,但明显比模型生成的差 —— 连续出现说明 claude 调用在挂,去看 book.log。
const FALLBACK_FOLLOWUPS = [
  '这本书的核心论点是什么,作者靠哪几类材料撑起来,哪一环最薄弱',
  '从"相关"走到"因果"这一步作者怎么完成的,有没有可能是共同的第三因',
  '什么情况下这个论点会失效?有没有反例的社会、时期或人群',
  '这个说法承接自谁,作者相对前人新增了什么,学界谁反对、反对哪一点',
  '放到今天、放到中文语境是什么位置,最不能直接搬的是哪一点',
  '这套论证有没有过度解释的风险,最强的反方论证长什么样',
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
    fallback: true, // 让卡面能标出"这组是兜底问题",不用她去翻日志才知道降级了
  };
}
