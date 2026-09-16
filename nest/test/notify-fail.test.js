import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, access, realpath } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notifyFailure, shortHostname, firstLine } from '../lib/notify-fail.js';
import { bookCardMain } from '../book-card.js';
import { hippoCardMain } from '../hippo-card.js';

// 2026-09-17 加(mini 定时任务「失败不出声」统一排查):两条扭蛋的失败出口必须
// ①退出码 1 ②发一条 TG 报警(经 cobbler-notify.sh,桩掉) ③日志行带 ISO 时间戳;
// 凭证文件坏了不再算成功。末尾两组用真实子进程跑 9be5895 的旧版 CLI 作区分力校准:
// 同样「不放 tg.json」,旧版必须 delivered=none、退出码 0、0 条报警——那正是这次要修的洞。
// 哪天旧版那组变红,说明夹具已经测不到它该测的东西。
//
// 演练开关(供 owner 事后真发一条):DRILL_CASE=book-sendfail node --test test/notify-fail.test.js
// 只对「book-sendfail」这一个用例把桩接到真实 cobbler-notify.sh;别的用例永远不出真消息。

const pexec = promisify(execFile);
const NEST = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = dirname(NEST);
const OLD_COMMIT = '9be5895';           // 加报警之前的最后一个 commit
const REAL_HOME = process.env.HOME;
const MINPATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;
const GEN_BOOK = { cardTitle: 'T', cardBody: 'B', quote: null, followups: ['这个论点靠什么撑?', '反例在哪?', '还能怎么问?'], mutter: 'M' };
const GEN_HIPPO = { cardTitle: 'T', cardBody: 'B', followups: ['这个论点靠什么撑?', '反例在哪?', '还能怎么问?'], mutter: 'M' };
const econnreset = async () => { throw Object.assign(new Error('fetch failed: ECONNRESET api.telegram.org:443'), { code: 'ECONNRESET' }); };

// ── 桩:TG 报警(写法照 实施规范 §2,含演练开关) ──
async function makeNotifyStub(dir) {
  const tgLog = join(dir, 'tg.log');
  const stub = join(dir, 'notify-stub.sh');
  await writeFile(stub, `#!/bin/bash
printf '%s\\n<<<END>>>\\n' "$1" >> "${tgLog}"
if [ -n "\${DRILL_REAL_NOTIFY:-}" ]; then
  HOME="$REAL_HOME" "$DRILL_REAL_NOTIFY" "【演练·非真实故障,无需处理】$1"; echo "drill: real send rc=$?" >> "${tgLog}"
fi
exit "\${STUB_NOTIFY_RC:-0}"
`, { mode: 0o755 });
  return { stub, tgLog };
}
async function tgText(tgLog) { try { return await readFile(tgLog, 'utf8'); } catch { return ''; } }
async function ntg(tgLog) { return (await tgText(tgLog)).split('\n').filter((l) => l === '<<<END>>>').length; }
async function exists(p) { try { await access(p); return true; } catch { return false; } }

// ── 夹具 ──
async function bookFixture() {
  const root = await mkdtemp(join(tmpdir(), 'cobbler-alerts-book-'));
  const ebooksRoot = join(root, 'ebooks');
  await mkdir(join(ebooksRoot, 'book1'), { recursive: true });
  await writeFile(join(ebooksRoot, 'book1', 'metadata.json'), JSON.stringify({ title: '测试书', author: '某人' }));
  await writeFile(join(ebooksRoot, 'book1', 'FULL.md'), '这是一段正文。\n\n'.repeat(800)); // ≥5000 字节才算有效摄入
  const dataDir = join(root, 'data'); await mkdir(dataDir);
  const personaPath = join(root, 'persona.md'); await writeFile(personaPath, 'PERSONA');
  const { stub, tgLog } = await makeNotifyStub(root);
  const cfg = { ebooksRoot, dataDir, personaPath, todayISO: '2026-09-17', rng: () => 0, bookGen: async () => GEN_BOOK, sendImpl: async () => {} };
  return { root, dataDir, stub, tgLog, cfg };
}
async function hippoFixture() {
  const root = await mkdtemp(join(tmpdir(), 'cobbler-alerts-hippo-'));
  const hippoDir = join(root, 'wikiroot');
  await mkdir(join(hippoDir, 'wiki', 'concepts'), { recursive: true });
  await writeFile(join(hippoDir, 'wiki', 'concepts', '测试页.md'), '---\ntitle: 测试页\ntype: concept\ncreated: 2026-09-01\n---\n\n这是一段正文摘要。\n');
  const dataDir = join(root, 'data'); await mkdir(dataDir);
  const personaPath = join(root, 'persona.md'); await writeFile(personaPath, 'PERSONA');
  const { stub, tgLog } = await makeNotifyStub(root);
  const cfg = { hippoDir, dataDir, personaPath, todayISO: '2026-09-17', rng: () => 0, hippoGen: async () => GEN_HIPPO, sendImpl: async () => {}, gitPull: async () => {} };
  return { root, dataDir, stub, tgLog, cfg };
}
const writeTg = (dataDir) => writeFile(join(dataDir, 'tg.json'), JSON.stringify({ token: 'stub-token', chatId: '1' })); // 假值,不是真凭证

// 在本进程里跑 CLI 出口:环境变量临时设、跑完还原;被测代码会把 process.exitCode 置 1,
// 断言取值后必须还原,否则 node --test 把这个测试文件整体当失败。
async function drive(mainFn, cfg, env = {}) {
  const saved = {}; const savedExit = process.exitCode;
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const out = [], err = [];
  try {
    const result = await mainFn(cfg, { out: (...a) => out.push(a.map(String).join(' ')), err: (...a) => err.push(a.map(String).join(' ')) });
    return { result, exitCode: process.exitCode, out, err };
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    process.exitCode = savedExit;
  }
}
const drillEnv = (name) => (process.env.DRILL_CASE === name
  ? { DRILL_REAL_NOTIFY: `${REAL_HOME}/Downloads/sync-bridge/scripts-bin/cobbler-notify.sh`, REAL_HOME }
  : {});

// ════ notify-fail.js 本体 ════
test('shortHostname 去掉 .local;firstLine 只取第一行且截 200 字', () => {
  assert.ok(!shortHostname().endsWith('.local'));
  assert.equal(firstLine(new Error('第一行\n第二行')), '第一行');
  assert.equal(firstLine('x'.repeat(500)).length, 200);
  assert.equal(firstLine(null), 'null');
});

test('notifyFailure:桩成功 → 返回 true,消息原样到桩', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notify-'));
  const { stub, tgLog } = await makeNotifyStub(dir);
  const logs = [];
  assert.equal(await notifyFailure('测试报警 一行', { bin: stub, log: (m) => logs.push(m) }), true);
  assert.equal(await ntg(tgLog), 1);
  assert.ok((await tgText(tgLog)).startsWith('测试报警 一行\n'));
  assert.equal(logs.length, 0);
});

test('notifyFailure:桩退出 3(缺凭证)→ 不抛、返回 false、日志一行带退出码', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notify-'));
  const { stub, tgLog } = await makeNotifyStub(dir);
  const logs = [];
  process.env.STUB_NOTIFY_RC = '3';
  try { assert.equal(await notifyFailure('x', { bin: stub, log: (m) => logs.push(m) }), false); }
  finally { delete process.env.STUB_NOTIFY_RC; }
  assert.equal(await ntg(tgLog), 1, '桩在退出 3 之前已记录:发送尝试过');
  assert.equal(logs.length, 1);
  assert.ok(logs[0].includes('TG 报警发送失败') && logs[0].includes('3'), logs[0]);
});

test('notifyFailure:bin 不存在 → 不抛、返回 false', async () => {
  const logs = [];
  assert.equal(await notifyFailure('x', { bin: '/nonexistent/cobbler-notify.sh', log: (m) => logs.push(m) }), false);
  assert.ok(logs[0].includes('TG 报警发送失败'));
});

test('notifyFailure:COBBLER_NOTIFY_BIN 环境变量生效(生产就靠它指向真脚本或桩)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notify-'));
  const { stub, tgLog } = await makeNotifyStub(dir);
  process.env.COBBLER_NOTIFY_BIN = stub;
  try { await notifyFailure('via env'); } finally { delete process.env.COBBLER_NOTIFY_BIN; }
  assert.equal(await ntg(tgLog), 1);
});

// ════ book-card:失败出口 ════
test('book-sendfail:sendImpl 抛 ECONNRESET → 卡片已写、1 条报警、退出码 1、fail 行带 ISO 时间戳', async (t) => {
  const f = await bookFixture(); await writeTg(f.dataDir);
  const r = await drive(bookCardMain, { ...f.cfg, sendImpl: econnreset }, { COBBLER_NOTIFY_BIN: f.stub, ...drillEnv('book-sendfail') });
  assert.equal(r.result, null);
  assert.equal(r.exitCode, 1);
  assert.ok(await exists(join(f.dataDir, 'book-cards', '2026-09-17.json')), '卡片文件要先落地,报警说的「卡片已写」才是真的');
  assert.equal(await ntg(f.tgLog), 1);
  const tg = await tgText(f.tgLog);
  assert.ok(tg.startsWith(`书堆扭蛋 12:30 失败@${shortHostname()}：`), tg);
  assert.ok(tg.includes('ECONNRESET') && tg.includes('日志 ~/Projects/cobbler/nest/data/book.log'), tg);
  assert.ok(r.err.length >= 1 && /^\[cobbler-book\] \S+ fail/.test(r.err[0]) && ISO_RE.test(r.err[0]), r.err[0]);
  assert.equal(r.out.length, 0, '失败时不许再打 ok 行');
  t.diagnostic(`TG 样张(book-sendfail): ${tg.replace(/\n<<<END>>>\n$/, '')}`);
  t.diagnostic(`日志样张(book-sendfail): ${r.err[0].split('\n')[0]}`);
});

test('book-nobooks:ebooksRoot 空目录 → 拒绝、1 条报警、退出码 1、没有卡片', async () => {
  const f = await bookFixture();
  const empty = join(f.root, 'empty-ebooks'); await mkdir(empty);
  const r = await drive(bookCardMain, { ...f.cfg, ebooksRoot: empty }, { COBBLER_NOTIFY_BIN: f.stub });
  assert.equal(r.exitCode, 1);
  assert.equal(await ntg(f.tgLog), 1);
  assert.ok((await tgText(f.tgLog)).includes('no books under'));
  assert.equal(await exists(join(f.dataDir, 'book-cards', '2026-09-17.json')), false);
});

test('book-notg:dataDir 里没有 tg.json → 不再当成功:1 条报警、退出码 1、卡片已写', async () => {
  const f = await bookFixture();   // 有意不写 tg.json
  let sent = 0;
  const r = await drive(bookCardMain, { ...f.cfg, sendImpl: async () => { sent += 1; } }, { COBBLER_NOTIFY_BIN: f.stub });
  assert.equal(r.exitCode, 1);
  assert.equal(sent, 0);
  assert.equal(await ntg(f.tgLog), 1);
  assert.ok((await tgText(f.tgLog)).includes('tg.json 缺 token/chatId'));
  assert.ok(await exists(join(f.dataDir, 'book-cards', '2026-09-17.json')));
});

test('book-ok:正常路径 → 0 条报警、退出码未置 1、ok 行带 ISO 时间戳与 delivered=tg', async () => {
  const f = await bookFixture(); await writeTg(f.dataDir);
  let sent = 0;
  const r = await drive(bookCardMain, { ...f.cfg, sendImpl: async ({ token, chatId, text }) => { sent += 1; assert.equal(token, 'stub-token'); assert.equal(chatId, '1'); assert.ok(text.length > 0); } }, { COBBLER_NOTIFY_BIN: f.stub });
  assert.equal(sent, 1);
  assert.equal(r.result?.delivered, 'tg');
  assert.notEqual(r.exitCode, 1);
  assert.equal(await ntg(f.tgLog), 0);
  assert.equal(r.err.length, 0);
  assert.ok(r.out.length === 1 && /^\[cobbler-book\] \S+ ok book="测试书" delivered=tg$/.test(r.out[0]) && ISO_RE.test(r.out[0]), r.out[0]);
});

test('book-notifyrc3:报警通道自己失败(桩退出 3)→ 日志有「TG 报警发送失败」、退出码仍 1', async () => {
  const f = await bookFixture(); await writeTg(f.dataDir);
  const r = await drive(bookCardMain, { ...f.cfg, sendImpl: econnreset }, { COBBLER_NOTIFY_BIN: f.stub, STUB_NOTIFY_RC: '3' });
  assert.equal(r.exitCode, 1);
  assert.equal(await ntg(f.tgLog), 1, '桩记录了尝试');
  assert.ok(r.err.some((l) => l.includes('TG 报警发送失败') && l.includes('3')), r.err.join('\n'));
});

// ════ hippo-card:失败出口 ════
test('hippo-gitpull-reject:git pull 桩 reject → 仍出卡、delivered=tg、0 条报警', async () => {
  const f = await hippoFixture(); await writeTg(f.dataDir);
  const r = await drive(hippoCardMain, { ...f.cfg, gitPull: () => Promise.reject(new Error('offline')) }, { COBBLER_NOTIFY_BIN: f.stub });
  assert.equal(r.result?.delivered, 'tg');
  assert.notEqual(r.exitCode, 1);
  assert.equal(await ntg(f.tgLog), 0);
  assert.ok(await exists(join(f.dataDir, 'hippo-cards', '2026-09-17.json')));
  assert.ok(/^\[cobbler-hippo\] \S+ ok page="测试页" delivered=tg$/.test(r.out[0]), r.out[0]);
});

test('hippo-sendfail:sendImpl 抛 ECONNRESET → 卡片已写、1 条报警、退出码 1', async (t) => {
  const f = await hippoFixture(); await writeTg(f.dataDir);
  const r = await drive(hippoCardMain, { ...f.cfg, sendImpl: econnreset }, { COBBLER_NOTIFY_BIN: f.stub });
  assert.equal(r.exitCode, 1);
  assert.ok(await exists(join(f.dataDir, 'hippo-cards', '2026-09-17.json')));
  assert.equal(await ntg(f.tgLog), 1);
  const tg = await tgText(f.tgLog);
  assert.ok(tg.startsWith(`知识扭蛋 21:00 失败@${shortHostname()}：`) && tg.includes('ECONNRESET') && tg.includes('日志 ~/Projects/cobbler/nest/data/hippo.log'), tg);
  assert.ok(/^\[cobbler-hippo\] \S+ fail/.test(r.err[0]) && ISO_RE.test(r.err[0]), r.err[0]);
  t.diagnostic(`TG 样张(hippo-sendfail): ${tg.replace(/\n<<<END>>>\n$/, '')}`);
});

test('hippo-notg:没有 tg.json → 1 条报警、退出码 1', async () => {
  const f = await hippoFixture();
  const r = await drive(hippoCardMain, f.cfg, { COBBLER_NOTIFY_BIN: f.stub });
  assert.equal(r.exitCode, 1);
  assert.equal(await ntg(f.tgLog), 1);
  assert.ok((await tgText(f.tgLog)).includes('tg.json 缺 token/chatId'));
});

test('hippo-nopages:hippoDir 下没有页面 → 1 条报警含「no pages under」、退出码 1', async () => {
  const f = await hippoFixture();
  const empty = join(f.root, 'empty-wiki'); await mkdir(empty);
  const r = await drive(hippoCardMain, { ...f.cfg, hippoDir: empty }, { COBBLER_NOTIFY_BIN: f.stub });
  assert.equal(r.exitCode, 1);
  assert.equal(await ntg(f.tgLog), 1);
  assert.ok((await tgText(f.tgLog)).includes('no pages under'));
});

// ════ 区分力校准:真实子进程跑旧版(9be5895)与新版 CLI,同样不放 tg.json ════
// 沙箱树里 data/ 是空的,dataDir 由脚本位置决定(new URL('./data', import.meta.url)),
// 所以必须拷一份出来跑;claude 用假脚本顶替(只回一段合格 JSON),git 用假脚本顶替(exit 1,离线形态)。
async function cliTree(kind) {
  const root = await mkdtemp(join(tmpdir(), `cobbler-cli-${kind}-`));
  const nest = join(root, 'nest');
  await mkdir(nest);
  const files = ['nest/lib', 'nest/book-card.js', 'nest/hippo-card.js', 'nest/persona.md', 'nest/package.json'];
  if (kind === 'old') {
    execFileSync('bash', ['-c', `git -C "${REPO}" archive ${OLD_COMMIT} ${files.join(' ')} | tar -x -C "${root}"`], { stdio: ['ignore', 'ignore', 'pipe'] });
  } else {
    for (const f of files) await cp(join(REPO, f), join(root, f), { recursive: true });
  }
  await mkdir(join(nest, 'data'));   // 有意不放 tg.json
  // 假 claude:吞 stdin,回一段合格卡片 JSON
  const bin = join(root, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'claude'), `#!/bin/bash\ncat > /dev/null\nprintf '%s' '${JSON.stringify(GEN_HIPPO)}'\n`, { mode: 0o755 });
  await writeFile(join(bin, 'git'), '#!/bin/bash\necho "stub git: offline" >&2\nexit 1\n', { mode: 0o755 });
  const { stub, tgLog } = await makeNotifyStub(root);
  // 书库 / wiki 夹具
  const ebooks = join(root, 'ebooks'); await mkdir(join(ebooks, 'book1'), { recursive: true });
  await writeFile(join(ebooks, 'book1', 'metadata.json'), JSON.stringify({ title: '测试书', author: '某人' }));
  await writeFile(join(ebooks, 'book1', 'FULL.md'), '这是一段正文。\n\n'.repeat(800));
  const wiki = join(root, 'wikiroot'); await mkdir(join(wiki, 'wiki', 'concepts'), { recursive: true });
  await writeFile(join(wiki, 'wiki', 'concepts', '测试页.md'), '---\ntitle: 测试页\ntype: concept\n---\n\n这是一段正文摘要。\n');
  return { root, nest, bin, stub, tgLog, ebooks, wiki };
}
async function runCli(t, script, extraEnv) {
  const env = { HOME: t.root, PATH: `${t.bin}:${MINPATH}`, COBBLER_CLAUDE_BIN: join(t.bin, 'claude'), COBBLER_NOTIFY_BIN: t.stub, ...extraEnv };
  // macOS 的 tmpdir 是 /var → /private/var 的 symlink:脚本里 argv[1] === fileURLToPath(import.meta.url)
  // 那道「直接执行才跑」的闸拿 realpath 比,所以必须把 realpath 交给子进程,否则 CLI 段根本不执行、退出 0
  const real = await realpath(join(t.nest, script));
  try {
    const { stdout, stderr } = await pexec(process.execPath, [real], { env, timeout: 30000 });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

test('旧版 CLI(9be5895)·无 tg.json → 退出码 0、delivered=none、0 条报警(区分力校准:复现要修的洞)', async () => {
  const t = await cliTree('old');
  const b = await runCli(t, 'book-card.js', { COBBLER_EBOOKS_DIR: t.ebooks });
  assert.equal(b.code, 0, b.stderr);
  assert.ok(b.stdout.includes('[cobbler-book] ok book="测试书" delivered=none'), b.stdout);
  const h = await runCli(t, 'hippo-card.js', { COBBLER_HIPPO_DIR: t.wiki });
  assert.equal(h.code, 0, h.stderr);
  assert.ok(h.stdout.includes('[cobbler-hippo] ok page="测试页" delivered=none'), h.stdout);
  assert.equal(await ntg(t.tgLog), 0);
  assert.ok(!ISO_RE.test(b.stdout) && !ISO_RE.test(h.stdout), '旧版 ok 行没有时间戳(也是本次要补的)');
});

test('新版 CLI·无 tg.json → 退出码 1、1 条报警各含「tg.json 缺 token/chatId」、fail 行带 ISO 时间戳', async (t) => {
  const tree = await cliTree('new');
  const b = await runCli(tree, 'book-card.js', { COBBLER_EBOOKS_DIR: tree.ebooks });
  assert.equal(b.code, 1, b.stderr);
  assert.equal(b.stdout, '', '失败时不打 ok 行');
  assert.ok(/\[cobbler-book\] \S+ fail/.test(b.stderr) && ISO_RE.test(b.stderr) && b.stderr.includes('tg.json 缺 token/chatId'), b.stderr);
  assert.ok(await exists(join(tree.nest, 'data', 'book-cards')), '卡片先落地再报失败');
  const h = await runCli(tree, 'hippo-card.js', { COBBLER_HIPPO_DIR: tree.wiki });
  assert.equal(h.code, 1, h.stderr);
  assert.ok(/\[cobbler-hippo\] \S+ fail/.test(h.stderr) && ISO_RE.test(h.stderr) && h.stderr.includes('tg.json 缺 token/chatId'), h.stderr);
  assert.equal(await ntg(tree.tgLog), 2);
  const tg = await tgText(tree.tgLog);
  assert.ok(tg.includes('书堆扭蛋 12:30 失败@') && tg.includes('知识扭蛋 21:00 失败@') && tg.includes('日志 ~/Projects/cobbler/nest/data/hippo.log'), tg);
  for (const line of tg.split('\n').filter((l) => l && l !== '<<<END>>>')) t.diagnostic(`TG 样张(新版 CLI 无 tg.json): ${line}`);
  t.diagnostic(`日志样张(新版 CLI 无 tg.json): ${b.stderr.split('\n')[0]}`);
});
