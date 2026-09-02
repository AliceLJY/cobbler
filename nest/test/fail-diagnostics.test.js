import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeExecFailure, describeBadCard, describeBadFollowups, execClaude, stripFollowupJunk } from '../lib/claude-gen.js';
import { generateBookCard } from '../lib/book-gen.js';

// 2026-09-02 事故的防复发断言。那天 12:30 书堆卡降级,日志里唯一的一行原因是
// 「claude 调用失败: Warning: no stdin data received in 3s...」——而实测证明这条
// warning 在**调用成功时也照样出现**,它是常驻噪音,不是死因。旧写法
// `err.stderr || err.message` 让它永远排在最前,把真实原因整个挤掉,
// 那天的死因至今不可回溯。这组测试红了,说明有人把留痕改回只看一处。

const bookInput = {
  persona: 'P',
  book: { title: 'B', author: 'A', dir: 'd' },
  excerpt: '节选正文',
};

test('调用失败时 stdout 必须留痕:2026-09-02 的形状是 stderr 只有噪音、真因在 stdout', () => {
  const err = Object.assign(new Error('Command failed'), {
    code: 1,
    stdout: "You've reached your limit",
    stderr: 'Warning: no stdin data received in 3s, proceeding without it.',
  });
  const out = describeExecFailure(err);
  assert.ok(out.includes("You've reached your limit"), 'stdout 里的真实原因不能被丢掉');
  assert.ok(out.includes('exit=1'), 'exit code 要记(单独不可作判据,但和输出合看能分型)');
  assert.ok(out.includes('stdin data received'), 'stderr 也留着,只是不再独占');
});

test('stdout/stderr 都空时退回 message,不至于留一行空白', () => {
  const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
  const out = describeExecFailure(err);
  assert.ok(out.includes('ENOENT'));
  assert.ok(out.includes('message='));
});

test('超时(被 kill)要能从日志看出来,别和普通非零退出混为一谈', () => {
  const err = Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM', code: null });
  const out = describeExecFailure(err);
  assert.ok(out.includes('killed=true') && out.includes('SIGTERM'));
});

test('describeBadCard 指名道姓说缺哪个字段,并附模型原样输出', () => {
  assert.equal(describeBadCard({ cardTitle: 'T', cardBody: 'B', mutter: 'M' }, ['cardTitle', 'cardBody', 'mutter']), null);
  const why = describeBadCard({ cardTitle: 'T', cardBody: '   ', mutter: 5 }, ['cardTitle', 'cardBody', 'mutter']);
  assert.ok(why.includes('cardBody') && why.includes('mutter'));
  assert.ok(why.includes('原样'), '要带上模型原样输出,否则事后仍判断不了它写错了什么');
});

test('describeBadFollowups 区分三种不合格形态', () => {
  assert.equal(describeBadFollowups(['a', 'b', 'c']), null);
  assert.ok(describeBadFollowups(null).includes('不是数组'));
  assert.ok(describeBadFollowups(['a', 'b']).includes('只有 2 条'));
  assert.ok(describeBadFollowups(['a', 'b', ' ']).includes('空条'));
});

// 2026-08-29 那次降级:日志里只有一行 FALLBACK,原因一个字都没有——因为字段/条子
// 校验失败时是静默 `return null`。这条测试保证降级必留原因。
test('条子不合格时 onFail 必须收到原因,不许静默降级(且两次尝试都留痕)', async () => {
  const fails = [];
  const execImpl = async () => ({ stdout: '{"cardTitle":"T","cardBody":"B","mutter":"M","followups":["只有一条"]}' });
  const r = await generateBookCard(bookInput, { execImpl, onFail: (m) => fails.push(m) });
  assert.equal(r, null);
  assert.equal(fails.length, 2, '重试那次的失败原因不能被吞掉');
  assert.ok(fails[0].includes('条子没写成') && fails[0].includes('只有 1 条'));
  assert.ok(fails[0].includes('[第 1/2 次,重试]'), '第一次失败要标明还会重试');
  assert.ok(!fails[1].includes('重试]'), '最后一次不标重试,它就是降级原因');
});

// 2026-09-02 实测:真实书库素材下模型约每三次坏一次 JSON 结构,而当天 12:30 的调用
// 失败在当晚复现不出来 —— 两类都是"再来一次大概率就好",所以先重试再兜底。
test('第一次写坏、第二次写好 → 拿到正常卡,不降级', async () => {
  let n = 0;
  const execImpl = async () => {
    n += 1;
    return { stdout: n === 1
      ? '{"cardTitle":"T","cardBody":"B","mutter":"M","followups":["a","2":"坏结构"]}'
      : '{"cardTitle":"好标题","cardBody":"好正文","mutter":"好嘟囔","followups":["a","b","c"]}' };
  };
  const fails = [];
  const r = await generateBookCard(bookInput, { execImpl, onFail: (m) => fails.push(m) });
  assert.equal(n, 2, '第一次失败后必须真的再调一次');
  assert.equal(r.cardTitle, '好标题');
  assert.equal(fails.length, 1, '第一次的失败仍要留痕,不能因为最终成功就假装没发生');
  assert.ok(fails[0].includes('[第 1/2 次,重试]'));
});

test('重试次数可关掉:attempts=1 时行为与改造前完全一致', async () => {
  const fails = [];
  let n = 0;
  const execImpl = async () => { n += 1; return { stdout: '{"cardTitle":"T","cardBody":"B","mutter":"M","followups":["只有一条"]}' }; };
  const r = await generateBookCard(bookInput, { execImpl, attempts: 1, onFail: (m) => fails.push(m) });
  assert.equal(n, 1);
  assert.equal(r, null);
  assert.equal(fails.length, 1);
  assert.ok(!fails[0].includes('重试]'));
});

test('字段缺失时 onFail 必须收到原因,不许静默降级', async () => {
  const fails = [];
  const execImpl = async () => ({ stdout: '{"cardTitle":"T","cardBody":"","mutter":"M","followups":["a","b","c"]}' });
  const r = await generateBookCard(bookInput, { execImpl, onFail: (m) => fails.push(m) });
  assert.equal(r, null);
  assert.ok(fails[0].includes('卡片不合格') && fails[0].includes('cardBody'));
});

// execFile 默认留着一个永不关闭的 stdin 管道,claude 因此等 3 秒 EOF 并写那条 warning。
// 主动 end 掉它,噪音从源头消失(实测 stderr 由那条 warning 变为完全空)。
test('execClaude 主动关掉子进程 stdin:噪音源头,不是可有可无的优化', async () => {
  let ended = false;
  const pending = Promise.resolve({ stdout: '{}' });
  pending.child = { stdin: { end: () => { ended = true; } } };
  await execClaude(() => pending, 'bin', [], {});
  assert.ok(ended, 'stdin 没被 end,那条常驻 warning 就会回来');
});

test('execClaude 对拿不到 .child 的 mock 不炸(测试里的 execImpl 就是这种)', async () => {
  const r = await execClaude(async () => ({ stdout: 'ok' }), 'bin', [], {});
  assert.deepEqual(r, { stdout: 'ok' });
});

// 2026-09-02 重跑今天那张卡时当场撞上:模型把 "followups_placeholder_removed" 写成了
// 合法的字符串元素,JSON 解析通过、"非空字符串"校验也通过,这条垃圾直接发进了她的 TG。
// prompt 里没有 placeholder 字样,是模型自己插的,只能在接收端拦。
test('模型插进数组的占位残留必须被摘掉,不许发出去', () => {
  const { clean, dropped } = stripFollowupJunk([
    '真条子:这个论点靠哪几类材料撑起来?',
    'followups_placeholder_removed',
    'instr_placeholder_1',
    'followups_2',
    '另一条真条子:反例在哪?',
  ]);
  assert.deepEqual(clean, ['真条子:这个论点靠哪几类材料撑起来?', '另一条真条子:反例在哪?']);
  assert.equal(dropped.length, 3);
});

// 第一版判据("纯 ASCII 标识符就丢")当场误杀了 book-gen / hippo-gen 测试里的
// 'F1' / 'a' / 'b' 这类短占位 fixture,6 条测试变红。故补长度下限,并把误伤面钉在这里。
test('过滤判据不许误伤真条子:英文条子、带标点的短句、短占位都要留下', () => {
  const real = [
    'What evidence supports this claim?',
    '这个说法承接自谁?',
    'A/B 对照能不能做?',
    'Chilisa (2012) 的证据链最薄弱在哪一环',
    'F1',            // 别人测试里的短占位,不是模型残留
    'a',
    'q'.repeat(300), // 超长纯字母串也不是变量名,别当残留丢掉
  ];
  const { clean, dropped } = stripFollowupJunk(real);
  assert.deepEqual(clean, real);
  assert.equal(dropped.length, 0);
});

test('残留被摘掉后条数不够,仍走降级而不是发一份缺斤少两的条子', async () => {
  const fails = [];
  const notes = [];
  const execImpl = async () => ({ stdout: '{"cardTitle":"T","cardBody":"B","mutter":"M","followups":["真问题一?","真问题二?","followups_3","placeholder_x"]}' });
  const r = await generateBookCard(bookInput, { execImpl, attempts: 1, onFail: (m) => fails.push(m), onNote: (m) => notes.push(m) });
  assert.equal(r, null, '摘掉残留后只剩 2 条,不够 3 条,应降级');
  assert.ok(notes[0].includes('丢弃 2 条'));
  assert.ok(fails[0].includes('只有 2 条'));
});

test('残留摘掉后条数仍够 → 正常出卡,且日志留一行说明模型又写残留了', async () => {
  const notes = [];
  const execImpl = async () => ({ stdout: '{"cardTitle":"T","cardBody":"B","mutter":"M","followups":["一?","二?","三?","followups_4"]}' });
  const r = await generateBookCard(bookInput, { execImpl, attempts: 1, onNote: (m) => notes.push(m) });
  assert.deepEqual(r.followups, ['一?', '二?', '三?']);
  assert.equal(notes.length, 1);
  assert.ok(notes[0].includes('followups_4'));
});
