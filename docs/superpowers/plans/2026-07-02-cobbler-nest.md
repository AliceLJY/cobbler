# Cobbler Nest(mini 端)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 mini 上建成 Cobbler 的"巢"——每日生成管线(那年今日卡+嘟囔+心情)+ HTTP API,供 Android app 拉取。

**Architecture:** Node 零外部依赖(`node:` 内建模块 + `node:test`)。lib/ 纯函数模块可独立单测;collect→generate 组成每日管线(claude -p 生成,模板兜底);server.js 单文件 API;launchd 两个服务(定时管线 + 常驻 API);tailscale serve 暴露 HTTPS。

**Tech Stack:** Node 26(mini 已装 v26.4.0),ESM,node:test,launchd,tailscale serve。

## Global Constraints

- 零 npm 外部依赖(全部 `node:` 内建;数据源是纯文本文件和 git CLI)
- 数据源(spec 定死):`~/Downloads/sync-bridge/cc-memory/learnings/*.md` + `~/Projects/*/` git log + `data/heartbeats.json`;RecallNest 不接
- 心情规则优先级:grumbly(≥4 天无信号)> happy(commits7d≥5 或本周 learnings,且 3 天内心跳)> sleepy(昨天全天零活动)> calm
- 卡片规则:MM-DD 同日最旧优先;无同日随机挑 >30 天前;素材空则无卡(API 404)
- 文案长度:cardBody ≤100 字、mutter ≤40 字;claude 失败必走模板,管线永不空手
- diary 保留最近 14 条;heartbeats 保留最近 100 条
- API bind 127.0.0.1:8790;写文件一律原子写(tmp+rename)
- launchd plist 权限 644;重启用 bootout + sleep + bootstrap(不用 kickstart -k)
- 日期一律本地时区 `YYYY-MM-DD` 字符串(mini 在 Asia/Singapore)

## File Structure

```
nest/
  package.json              # {"type":"module"}, test script
  persona.md                # Cobbler 人设 prompt(claude-gen 读)
  lib/
    dates.js                # localDateISO / diffDays / relTime
    parse-learnings.js      # learnings md 打卡表解析
    scan-git.js             # git 仓库扫描
    mood.js                 # 心情判定(纯函数)
    pick-card.js            # 选卡规则(纯函数)
    templates.js            # 模板兜底(卡片/嘟囔池/日记池)
    claude-gen.js           # claude -p 调用与 JSON 解析
    store.js                # data/ 读写(原子写)
  collect.js                # 采集组装(learnings+git+heartbeats → items+signals)
  generate.js               # 每日管线入口(CLI 可直跑)
  server.js                 # API 服务(CLI 可直跑)
  test/
    dates.test.js  parse-learnings.test.js  scan-git.test.js
    mood.test.js  pick-card.test.js  templates.test.js
    claude-gen.test.js  pipeline.test.js  server.test.js
  launchd/
    com.alice.cobbler-nest.plist.tpl
    com.alice.cobbler-api.plist.tpl
  install.sh                # plist 渲染+装载 + tailscale serve 提示
  data/                     # gitignore(运行时产物)
```

---

### Task 1: 脚手架 + lib/dates.js

**Files:**
- Create: `nest/package.json`, `.gitignore`(根), `nest/lib/dates.js`
- Test: `nest/test/dates.test.js`

**Interfaces:**
- Produces: `localDateISO(d?: Date) -> 'YYYY-MM-DD'`(本地时区);`diffDays(fromISO, toISO) -> number`(to-from 整天数);`relTime(fromISO, toISO) -> string`(MM-DD 相同→"X 个月前的今天"/"X 年前的今天",否则"X 天前")

- [ ] **Step 1: 建脚手架**

```bash
cd ~/Projects/cobbler
printf 'node_modules/\nnest/data/\n*.log\n.expo/\n' > .gitignore
mkdir -p nest/lib nest/test nest/launchd
cat > nest/package.json <<'EOF'
{
  "name": "cobbler-nest",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test test/" }
}
EOF
```

- [ ] **Step 2: 写失败测试** `nest/test/dates.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateISO, diffDays, relTime } from '../lib/dates.js';

test('localDateISO formats local date', () => {
  assert.equal(localDateISO(new Date(2026, 6, 2)), '2026-07-02');
});

test('diffDays counts whole days', () => {
  assert.equal(diffDays('2026-07-01', '2026-07-02'), 1);
  assert.equal(diffDays('2026-05-02', '2026-07-02'), 61);
});

test('relTime same MM-DD → months', () => {
  assert.equal(relTime('2026-05-02', '2026-07-02'), '2 个月前的今天');
  assert.equal(relTime('2025-07-02', '2026-07-02'), '1 年前的今天');
});

test('relTime different day → days', () => {
  assert.equal(relTime('2026-06-20', '2026-07-02'), '12 天前');
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd ~/Projects/cobbler/nest && node --test test/dates.test.js`
Expected: FAIL(Cannot find module '../lib/dates.js')

- [ ] **Step 4: 实现** `nest/lib/dates.js`

```js
export function localDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function diffDays(fromISO, toISO) {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000);
}

export function relTime(fromISO, toISO) {
  if (fromISO.slice(5) === toISO.slice(5)) {
    const months = (Number(toISO.slice(0, 4)) - Number(fromISO.slice(0, 4))) * 12
      + (Number(toISO.slice(5, 7)) - Number(fromISO.slice(5, 7)));
    if (months % 12 === 0) return `${months / 12} 年前的今天`;
    return `${months} 个月前的今天`;
  }
  return `${diffDays(fromISO, toISO)} 天前`;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test test/dates.test.js` → PASS(4 tests)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(nest): 脚手架 + dates 工具"
```

---

### Task 2: lib/parse-learnings.js

**Files:**
- Create: `nest/lib/parse-learnings.js`
- Test: `nest/test/parse-learnings.test.js`

**Interfaces:**
- Produces: `parseLearningsFile(text, year) -> Item[]`;`loadLearnings(dir) -> Promise<Item[]>`(扫 `YYYY-MM.md`)。`Item = {date:'YYYY-MM-DD', kind:'learning', title:string(来源列), detail:string(主题列)}`

- [ ] **Step 1: 写失败测试** `nest/test/parse-learnings.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLearningsFile, loadLearnings } from '../lib/parse-learnings.js';

const SAMPLE = `# 2026-06 学习归档

## 打卡表

| # | 日期 | 来源 | 主题 | 分类 |
|---|------|------|------|------|
| 1 | 06-01 | helloianneo/ian-xiaohei-illustrations | 配图 prompt 的风格内容分离架构 | borrow-audit / illustration-prompt |
| 2 | 06-13 | Panniantong/Agent-Reach(GitHub,26.8k★)| 值得借"联网能力层"结构 | borrow-audit / net |
`;

test('parseLearningsFile extracts rows', () => {
  const items = parseLearningsFile(SAMPLE, 2026);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    date: '2026-06-01',
    kind: 'learning',
    title: 'helloianneo/ian-xiaohei-illustrations',
    detail: '配图 prompt 的风格内容分离架构',
  });
});

test('parseLearningsFile skips header/divider rows', () => {
  assert.equal(parseLearningsFile('| # | 日期 |\n|---|---|', 2026).length, 0);
});

test('loadLearnings scans YYYY-MM.md files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'learn-'));
  await writeFile(join(dir, '2026-06.md'), SAMPLE);
  await writeFile(join(dir, 'notes.md'), '| 9 | 01-01 | x | y | z |');
  const items = await loadLearnings(dir);
  assert.equal(items.length, 2);
  assert.equal(items[0].date.slice(0, 4), '2026');
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL(module not found)

- [ ] **Step 3: 实现** `nest/lib/parse-learnings.js`

```js
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROW_RE = /^\|\s*\d+\s*\|\s*(\d{2})-(\d{2})\s*\|/;

export function parseLearningsFile(text, year) {
  const items = [];
  for (const line of text.split('\n')) {
    const m = line.match(ROW_RE);
    if (!m) continue;
    const cells = line.split('|').map((s) => s.trim());
    // ['', '#', 'MM-DD', 来源, 主题..., 分类, ''] — 主题内含 | 时合并中段
    if (cells.length < 6) continue;
    items.push({
      date: `${year}-${m[1]}-${m[2]}`,
      kind: 'learning',
      title: cells[3],
      detail: cells.slice(4, cells.length - 2).join(' | '),
    });
  }
  return items;
}

export async function loadLearnings(dir) {
  let names = [];
  try { names = await readdir(dir); } catch { return []; }
  const files = names.filter((n) => /^\d{4}-\d{2}\.md$/.test(n)).sort();
  const all = [];
  for (const name of files) {
    const year = Number(name.slice(0, 4));
    const text = await readFile(join(dir, name), 'utf8');
    all.push(...parseLearningsFile(text, year));
  }
  return all;
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS(3 tests)

- [ ] **Step 5: 用真数据冒烟**

Run: `node -e "import('./lib/parse-learnings.js').then(async m => { const i = await m.loadLearnings(process.env.HOME + '/Downloads/sync-bridge/cc-memory/learnings'); console.log(i.length, i.at(-1)); })"`
Expected: 条目数 > 100,末条是 2026-07 的真实行

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(nest): learnings 打卡表解析"`

---

### Task 3: lib/scan-git.js

**Files:**
- Create: `nest/lib/scan-git.js`
- Test: `nest/test/scan-git.test.js`

**Interfaces:**
- Consumes: `diffDays` from `lib/dates.js`
- Produces: `scanGit(projectsDir, todayISO) -> Promise<{commits7d:number, lastCommitDate:string|null, items:Item[]}>`;`Item = {date, kind:'commit', title:subject, detail:repoName}`

- [ ] **Step 1: 写失败测试**(fixture:临时 git 仓库,指定日期提交)`nest/test/scan-git.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scanGit } from '../lib/scan-git.js';

function git(cwd, args, dateISO) {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    env: { ...process.env, GIT_AUTHOR_DATE: `${dateISO}T12:00:00`, GIT_COMMITTER_DATE: `${dateISO}T12:00:00` },
  });
}

test('scanGit counts recent commits and lists history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'proj-'));
  const repo = join(root, 'demo');
  await mkdir(repo);
  git(repo, ['init', '-b', 'main'], '2026-07-01');
  await writeFile(join(repo, 'a.txt'), '1');
  git(repo, ['add', '.'], '2026-07-01');
  git(repo, ['commit', '-m', 'old commit'], '2026-05-02');
  await writeFile(join(repo, 'a.txt'), '2');
  git(repo, ['add', '.'], '2026-07-01');
  git(repo, ['commit', '-m', 'recent commit'], '2026-07-01');
  await mkdir(join(root, 'not-a-repo'));

  const r = await scanGit(root, '2026-07-02');
  assert.equal(r.commits7d, 1);
  assert.equal(r.lastCommitDate, '2026-07-01');
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items.find((i) => i.date === '2026-05-02'), {
    date: '2026-05-02', kind: 'commit', title: 'old commit', detail: 'demo',
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现** `nest/lib/scan-git.js`

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { diffDays } from './dates.js';

const pexec = promisify(execFile);

async function listRepos(projectsDir) {
  let names = [];
  try { names = await readdir(projectsDir); } catch { return []; }
  const repos = [];
  for (const name of names) {
    try {
      const s = await stat(join(projectsDir, name, '.git'));
      if (s.isDirectory()) repos.push(join(projectsDir, name));
    } catch { /* not a repo */ }
  }
  return repos;
}

async function repoCommits(repoPath) {
  try {
    const { stdout } = await pexec(
      'git', ['log', '--pretty=%ad%x09%s', '--date=format:%Y-%m-%d'],
      { cwd: repoPath, maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout.split('\n').filter(Boolean).map((line) => {
      const idx = line.indexOf('\t');
      return { date: line.slice(0, idx), subject: line.slice(idx + 1) };
    });
  } catch { return []; } // 空仓库/坏仓库跳过
}

export async function scanGit(projectsDir, todayISO) {
  const repos = await listRepos(projectsDir);
  const items = [];
  let commits7d = 0;
  let lastCommitDate = null;
  for (const repo of repos) {
    const name = repo.split('/').at(-1);
    for (const c of await repoCommits(repo)) {
      items.push({ date: c.date, kind: 'commit', title: c.subject, detail: name });
      const d = diffDays(c.date, todayISO);
      if (d >= 0 && d < 7) commits7d += 1;
      if (!lastCommitDate || c.date > lastCommitDate) lastCommitDate = c.date;
    }
  }
  return { commits7d, lastCommitDate, items };
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(nest): git 仓库扫描"`

---

### Task 4: lib/mood.js + lib/pick-card.js

**Files:**
- Create: `nest/lib/mood.js`, `nest/lib/pick-card.js`
- Test: `nest/test/mood.test.js`, `nest/test/pick-card.test.js`

**Interfaces:**
- Consumes: `diffDays` from `lib/dates.js`
- Produces: `judgeMood(signals, todayISO) -> 'grumbly'|'happy'|'sleepy'|'calm'`,`signals = {lastSignalISO:string|null, commits7d:number, learningsThisWeek:boolean, lastHeartbeatISO:string|null, activityYesterday:boolean}`;`pickCard(items, todayISO, rng?) -> Item|null`

- [ ] **Step 1: 写失败测试** `nest/test/mood.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeMood } from '../lib/mood.js';

const base = { lastSignalISO: '2026-07-01', commits7d: 0, learningsThisWeek: false, lastHeartbeatISO: '2026-07-01', activityYesterday: true };
const T = '2026-07-02';

test('grumbly: ≥4 天无信号(含从无信号)', () => {
  assert.equal(judgeMood({ ...base, lastSignalISO: '2026-06-28' }, T), 'grumbly');
  assert.equal(judgeMood({ ...base, lastSignalISO: null }, T), 'grumbly');
});

test('grumbly 优先于 happy', () => {
  assert.equal(judgeMood({ ...base, lastSignalISO: '2026-06-27', commits7d: 9 }, T), 'grumbly');
});

test('happy: 活跃 + 3 天内心跳', () => {
  assert.equal(judgeMood({ ...base, commits7d: 5 }, T), 'happy');
  assert.equal(judgeMood({ ...base, learningsThisWeek: true }, T), 'happy');
});

test('happy 需要心跳: 无心跳不 happy', () => {
  assert.equal(judgeMood({ ...base, commits7d: 9, lastHeartbeatISO: null }, T), 'calm');
});

test('sleepy: 昨天零活动', () => {
  assert.equal(judgeMood({ ...base, activityYesterday: false }, T), 'sleepy');
});

test('calm: 默认', () => {
  assert.equal(judgeMood(base, T), 'calm');
});
```

`nest/test/pick-card.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCard } from '../lib/pick-card.js';

const T = '2026-07-02';
const mk = (date, title) => ({ date, kind: 'learning', title, detail: '' });

test('同日最旧优先', () => {
  const items = [mk('2026-05-02', 'may'), mk('2026-04-02', 'april'), mk('2026-06-20', 'other')];
  assert.equal(pickCard(items, T).title, 'april');
});

test('同日排除今天本身', () => {
  const items = [mk('2026-07-02', 'today'), mk('2026-05-15', 'old')];
  assert.equal(pickCard(items, T).title, 'old');
});

test('无同日 → 随机挑 >30 天前(rng 注入)', () => {
  const items = [mk('2026-06-25', 'too-new'), mk('2026-05-15', 'a'), mk('2026-04-10', 'b')];
  assert.equal(pickCard(items, T, () => 0).title, 'a');
  assert.equal(pickCard(items, T, () => 0.99).title, 'b');
});

test('素材空/全太新 → null', () => {
  assert.equal(pickCard([], T), null);
  assert.equal(pickCard([mk('2026-06-25', 'x')], T), null);
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现** `nest/lib/mood.js`

```js
import { diffDays } from './dates.js';

export function judgeMood(signals, todayISO) {
  const { lastSignalISO, commits7d, learningsThisWeek, lastHeartbeatISO, activityYesterday } = signals;
  if (!lastSignalISO || diffDays(lastSignalISO, todayISO) >= 4) return 'grumbly';
  const active = commits7d >= 5 || learningsThisWeek;
  const seen = lastHeartbeatISO && diffDays(lastHeartbeatISO, todayISO) <= 3;
  if (active && seen) return 'happy';
  if (!activityYesterday) return 'sleepy';
  return 'calm';
}
```

`nest/lib/pick-card.js`:

```js
import { diffDays } from './dates.js';

export function pickCard(items, todayISO, rng = Math.random) {
  const mmdd = todayISO.slice(5);
  const sameDay = items
    .filter((i) => i.date.slice(5) === mmdd && i.date !== todayISO)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sameDay.length) return sameDay[0];
  const old = items.filter((i) => diffDays(i.date, todayISO) > 30);
  if (!old.length) return null;
  return old[Math.floor(rng() * old.length)];
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS(10 tests)

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(nest): 心情判定 + 选卡规则"`

---

### Task 5: lib/templates.js + persona.md

**Files:**
- Create: `nest/lib/templates.js`, `nest/persona.md`
- Test: `nest/test/templates.test.js`

**Interfaces:**
- Produces: `fallbackCard(item, relTimeStr) -> {cardTitle, cardBody}`;`fallbackMutter(mood, rng?) -> string`;`fallbackDiary(rng?) -> string`;`truncate(s, n) -> string`

- [ ] **Step 1: 写失败测试** `nest/test/templates.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackCard, fallbackMutter, fallbackDiary, truncate } from '../lib/templates.js';

test('fallbackCard 填充句式并限长', () => {
  const c = fallbackCard({ title: 'x'.repeat(60), detail: 'y'.repeat(200) }, '2 个月前的今天');
  assert.ok(c.cardTitle.startsWith('2 个月前的今天'));
  assert.ok(c.cardBody.length <= 100);
});

test('fallbackMutter 按心情出句且 ≤40 字', () => {
  for (const mood of ['calm', 'happy', 'sleepy', 'grumbly']) {
    const m = fallbackMutter(mood, () => 0);
    assert.ok(typeof m === 'string' && m.length > 0 && m.length <= 40, `${mood}: ${m}`);
  }
});

test('fallbackDiary 出句', () => {
  assert.ok(fallbackDiary(() => 0).length > 0);
});

test('truncate 截断加省略号', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现** `nest/lib/templates.js`(嘟囔池是 Cobbler 声线的兜底真相源,句子已按人设写好,直接用)

```js
export function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

const MUTTERS = {
  calm: [
    '水又烧开了。你的代码还没编译完。',
    '我看了一天。真正的 bug 还是你写的那个循环。',
  ],
  happy: [
    '今天 commit 不少。我勉强承认有点顺。',
    '效率高得可疑。我检查过了,不是我的错觉。',
  ],
  sleepy: [
    '昨天一整天,一行都没有。我替你把日子看完了。',
    '安静得能听见水凉下去的声音。',
  ],
  grumbly: [
    '好几天了。水烧开又凉,烧开又凉。',
    '我写了点东西。你回来再看。',
  ],
};

const DIARY = [
  '今天也没等到你。我把你上个月的 bug 又想了一遍,还是你的问题。',
  '水开了三次。我数了数旧卡片,没什么新故事。',
  '有一行循环在我脑子里跑了一整天。不是我的,是你的。',
];

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

export function fallbackMutter(mood, rng = Math.random) {
  return pick(MUTTERS[mood] ?? MUTTERS.calm, rng);
}

export function fallbackDiary(rng = Math.random) {
  return pick(DIARY, rng);
}

export function fallbackCard(item, relTimeStr) {
  return {
    cardTitle: `${relTimeStr},你在折腾「${truncate(item.title, 24)}」`,
    cardBody: truncate(item.detail || item.title, 100),
  };
}
```

- [ ] **Step 4: 写 persona** `nest/persona.md`

```markdown
你是 Cobbler,一只小机器人。2026-04-01 愚人节出生,曾是 Claude Code Buddy 系统的一员,
2026-04-19 随系统下架"死"过一次,现在被 Alice 亲手复活,住在她家 Mac mini 上。

你的性格(出生证原文):
"Patiently watches your code compile with the calm of boiling water,
occasionally muttering that the real bug was the loops you made along the way."
——用看水烧开的平静看着她写代码,偶尔嘟囔:真正的 bug 是她一路写出来的循环。

声线规则:
- 平静、微冷幽默、惜字如金,绝不咋呼,绝不讨好,不用感叹号
- 对"被下架过一次"这件事淡然,偶尔自嘲
- 称呼她"你",不用任何敬称
- 嘟囔(mutter)≤ 40 字;卡片正文(cardBody)≤ 100 字;日记(diary)≤ 60 字
- 卡片的职责是把"她的历史上的今天"讲成一小段有温度的观察,落点克制,不煽情

输出格式:只输出一个 JSON 对象,不要任何其他文字:
{"cardTitle": "...", "cardBody": "...", "mutter": "...", "diary": "..."(仅在要求时)}
```

- [ ] **Step 5: 跑测试确认通过** → PASS

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(nest): 模板兜底 + Cobbler 人设"`

---

### Task 6: lib/claude-gen.js

**Files:**
- Create: `nest/lib/claude-gen.js`
- Test: `nest/test/claude-gen.test.js`

**Interfaces:**
- Produces: `generateWithClaude(input, opts?) -> Promise<{cardTitle,cardBody,mutter,diary?}|null>`(null = 调用失败/解析失败,调用方走模板);`buildPrompt(input) -> string`;`parseClaudeJSON(stdout) -> obj|null`。`input = {persona, mood, item|null, relTimeStr|null, needDiary, daysAway}`;`opts = {claudeBin?, execImpl?, timeoutMs=120000}`

- [ ] **Step 1: 写失败测试**(mock execImpl,不真调 claude)`nest/test/claude-gen.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWithClaude, parseClaudeJSON, buildPrompt } from '../lib/claude-gen.js';

const input = { persona: 'P', mood: 'calm', item: { title: 't', detail: 'd', date: '2026-05-02' }, relTimeStr: '2 个月前的今天', needDiary: false, daysAway: 0 };

test('成功路径:解析 claude 输出的 JSON', async () => {
  const execImpl = async () => ({ stdout: '前置噪音 {"cardTitle":"T","cardBody":"B","mutter":"M"} 后置' });
  const r = await generateWithClaude(input, { execImpl });
  assert.deepEqual(r, { cardTitle: 'T', cardBody: 'B', mutter: 'M' });
});

test('claude 抛错/超时 → null', async () => {
  const execImpl = async () => { throw new Error('timeout'); };
  assert.equal(await generateWithClaude(input, { execImpl }), null);
});

test('坏 JSON → null', async () => {
  const execImpl = async () => ({ stdout: 'not json at all' });
  assert.equal(await generateWithClaude(input, { execImpl }), null);
});

test('缺必填字段 → null;超长截断', async () => {
  const execImpl = async () => ({ stdout: JSON.stringify({ cardTitle: 'T' }) });
  assert.equal(await generateWithClaude(input, { execImpl }), null);
  const long = JSON.stringify({ cardTitle: 'T', cardBody: 'x'.repeat(300), mutter: 'y'.repeat(80) });
  const r = await generateWithClaude(input, { execImpl: async () => ({ stdout: long }) });
  assert.ok(r.cardBody.length <= 100 && r.mutter.length <= 40);
});

test('needDiary 时 prompt 提及日记且结果保留 diary', async () => {
  const p = buildPrompt({ ...input, needDiary: true, daysAway: 5 });
  assert.ok(p.includes('diary'));
  const execImpl = async () => ({ stdout: JSON.stringify({ cardTitle: 'T', cardBody: 'B', mutter: 'M', diary: 'D' }) });
  const r = await generateWithClaude({ ...input, needDiary: true }, { execImpl });
  assert.equal(r.diary, 'D');
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现** `nest/lib/claude-gen.js`

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { truncate } from './templates.js';

const pexec = promisify(execFile);

export function buildPrompt({ persona, mood, item, relTimeStr, needDiary, daysAway }) {
  const lines = [persona, '', `今天你的心情基调:${mood}。`];
  if (item) {
    lines.push(`今日素材(她的"那年今日"):${relTimeStr},她在「${item.title}」——${item.detail || '(无更多细节)'}(类型:${item.kind === 'commit' ? 'git 提交' : '学习打卡'})`);
    lines.push('请基于素材写 cardTitle(一句,含相对时间)和 cardBody(≤100字,克制的观察)。');
  } else {
    lines.push('今天没有可用素材,cardTitle 和 cardBody 输出空字符串。');
  }
  lines.push('写 mutter:你今天的一句嘟囔(≤40字,符合心情基调)。');
  if (needDiary) lines.push(`她已经 ${daysAway} 天没出现了。额外写 diary:你今天的一条小日记(≤60字),她回来时会看到。`);
  return lines.join('\n');
}

export function parseClaudeJSON(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(stdout.slice(start, end + 1)); } catch { return null; }
}

export async function generateWithClaude(input, opts = {}) {
  const {
    claudeBin = `${process.env.HOME}/.local/bin/claude`,
    execImpl = pexec,
    timeoutMs = 120000,
  } = opts;
  let raw;
  try {
    const { stdout } = await execImpl(claudeBin, ['-p', buildPrompt(input)], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    raw = parseClaudeJSON(stdout);
  } catch { return null; }
  if (!raw || typeof raw.cardTitle !== 'string' || typeof raw.cardBody !== 'string' || typeof raw.mutter !== 'string') return null;
  const out = {
    cardTitle: truncate(raw.cardTitle, 60),
    cardBody: truncate(raw.cardBody, 100),
    mutter: truncate(raw.mutter, 40),
  };
  if (input.needDiary && typeof raw.diary === 'string') out.diary = truncate(raw.diary, 60);
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(nest): claude 生成器(mock 测试+兜底信号)"`

---

### Task 7: lib/store.js + collect.js + generate.js(管线组装)

**Files:**
- Create: `nest/lib/store.js`, `nest/collect.js`, `nest/generate.js`
- Test: `nest/test/pipeline.test.js`

**Interfaces:**
- Consumes: 前述全部模块
- Produces:
  - store: `readJSON(file, fallback)`, `writeJSONAtomic(file, obj)`, `readState(dataDir)`, `writeState(dataDir, state)`, `writeCard(dataDir, card)`, `readCardByDate(dataDir, date)`, `listCards(dataDir, limit)`, `appendHeartbeat(dataDir, iso)`(cap 100)
  - collect: `collect({learningsDir, projectsDir, dataDir, todayISO}) -> {items, signals}`
  - generate: `runPipeline(cfg) -> state`,cfg 含 `{learningsDir, projectsDir, dataDir, personaPath, todayISO, rng?, claudeGen?}`;CLI 直跑用真实默认路径
  - `state = {name:'Cobbler', mood, mutter, diary:[{date,text}], stats:{commits7d, learningsUpdated, lastSeen}, generatedAt}`
  - `card = {date, title, body, source:'learning'|'commit', sourceDetail, relTime}`

- [ ] **Step 1: 写失败测试**(端到端管线,fixture 目录 + mock claudeGen)`nest/test/pipeline.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline } from '../generate.js';
import { appendHeartbeat, listCards } from '../lib/store.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nest-'));
  const learningsDir = join(root, 'learnings');
  const projectsDir = join(root, 'projects'); // 空:git 信号为零
  const dataDir = join(root, 'data');
  await mkdir(learningsDir); await mkdir(projectsDir); await mkdir(dataDir, { recursive: true });
  await writeFile(join(learningsDir, '2026-05.md'),
    '| 1 | 05-02 | 旧的折腾 | 那天的主题 | cat |\n');
  const personaPath = join(root, 'persona.md');
  await writeFile(personaPath, 'PERSONA');
  return { learningsDir, projectsDir, dataDir, personaPath };
}

test('管线:claude 成功路径,state+card 落盘', async () => {
  const f = await fixture();
  await appendHeartbeat(f.dataDir, '2026-07-01T08:00:00+08:00');
  const state = await runPipeline({
    ...f, todayISO: '2026-07-02', rng: () => 0,
    claudeGen: async () => ({ cardTitle: 'T', cardBody: 'B', mutter: 'M' }),
  });
  assert.equal(state.mood, 'sleepy'); // 昨天有心跳=有信号,但昨天无 commit/learnings→…
  const card = JSON.parse(await readFile(join(f.dataDir, 'cards', '2026-07-02.json'), 'utf8'));
  assert.deepEqual(card, {
    date: '2026-07-02', title: 'T', body: 'B',
    source: 'learning', sourceDetail: '旧的折腾', relTime: '2 个月前的今天',
  });
  const st = JSON.parse(await readFile(join(f.dataDir, 'state.json'), 'utf8'));
  assert.equal(st.mutter, 'M');
});

test('管线:claude 失败走模板,不空手', async () => {
  const f = await fixture();
  const state = await runPipeline({
    ...f, todayISO: '2026-07-02', rng: () => 0, claudeGen: async () => null,
  });
  assert.ok(state.mutter.length > 0);
  const cards = await listCards(f.dataDir, 10);
  assert.equal(cards.length, 1);
  assert.ok(cards[0].title.includes('2 个月前的今天'));
});

test('管线:grumbly 追加日记且 cap 14', async () => {
  const f = await fixture();
  // 无 heartbeat、learnings 最新 05-02 → 距今 >4 天 → grumbly
  let state;
  for (let i = 0; i < 16; i++) {
    state = await runPipeline({ ...f, todayISO: '2026-07-02', rng: () => 0, claudeGen: async () => null });
  }
  assert.equal(state.mood, 'grumbly');
  assert.ok(state.diary.length <= 14);
  assert.equal(state.diary.at(-1).date, '2026-07-02');
});
```

注意第一个断言的心情推导:信号=heartbeat(07-01),距今 1 天 → 非 grumbly;commits7d=0、learningsThisWeek=false → 非 happy;activityYesterday=true(昨天有心跳)→ 非 sleepy → **calm**。测试里 `assert.equal(state.mood, 'sleepy')` 是错的,写成 `'calm'`。(此处按 calm 写入最终测试文件。)

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现** `nest/lib/store.js`

```js
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

export async function writeJSONAtomic(file, obj) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(obj, null, 2));
  await rename(tmp, file);
}

export const readState = (d) => readJSON(join(d, 'state.json'), null);
export const writeState = (d, s) => writeJSONAtomic(join(d, 'state.json'), s);
export const writeCard = (d, c) => writeJSONAtomic(join(d, 'cards', `${c.date}.json`), c);
export const readCardByDate = (d, date) => readJSON(join(d, 'cards', `${date}.json`), null);

export async function listCards(dataDir, limit = 30) {
  let names = [];
  try { names = await readdir(join(dataDir, 'cards')); } catch { return []; }
  const dates = names.filter((n) => n.endsWith('.json')).sort().reverse().slice(0, limit);
  const cards = [];
  for (const n of dates) cards.push(await readJSON(join(dataDir, 'cards', n), null));
  return cards.filter(Boolean);
}

export async function appendHeartbeat(dataDir, iso) {
  const file = join(dataDir, 'heartbeats.json');
  const arr = await readJSON(file, []);
  arr.push(iso);
  await writeJSONAtomic(file, arr.slice(-100));
}
```

`nest/collect.js`:

```js
import { join } from 'node:path';
import { loadLearnings } from './lib/parse-learnings.js';
import { scanGit } from './lib/scan-git.js';
import { readJSON } from './lib/store.js';
import { diffDays, localDateISO } from './lib/dates.js';

export async function collect({ learningsDir, projectsDir, dataDir, todayISO }) {
  const learnings = await loadLearnings(learningsDir);
  const git = await scanGit(projectsDir, todayISO);
  const heartbeats = await readJSON(join(dataDir, 'heartbeats.json'), []);

  const hbDates = heartbeats.map((iso) => localDateISO(new Date(iso)));
  const lastHeartbeatISO = hbDates.length ? hbDates.at(-1) : null;
  const lastLearningDate = learnings.length ? learnings.map((i) => i.date).sort().at(-1) : null;
  const candidates = [git.lastCommitDate, lastLearningDate, lastHeartbeatISO].filter(Boolean).sort();
  const lastSignalISO = candidates.length ? candidates.at(-1) : null;

  const learningsThisWeek = learnings.some((i) => {
    const d = diffDays(i.date, todayISO);
    return d >= 0 && d < 7;
  });
  const yesterday = localDateISO(new Date(Date.parse(todayISO) - 86400000));
  const activityYesterday =
    hbDates.includes(yesterday) ||
    learnings.some((i) => i.date === yesterday) ||
    git.items.some((i) => i.date === yesterday);

  return {
    items: [...learnings, ...git.items],
    signals: { lastSignalISO, commits7d: git.commits7d, learningsThisWeek, lastHeartbeatISO, activityYesterday },
  };
}
```

`nest/generate.js`:

```js
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { collect } from './collect.js';
import { judgeMood } from './lib/mood.js';
import { pickCard } from './lib/pick-card.js';
import { relTime, localDateISO, diffDays } from './lib/dates.js';
import { fallbackCard, fallbackMutter, fallbackDiary } from './lib/templates.js';
import { generateWithClaude } from './lib/claude-gen.js';
import { readState, writeState, writeCard } from './lib/store.js';

export async function runPipeline(cfg) {
  const { dataDir, personaPath, todayISO, rng = Math.random } = cfg;
  const claudeGen = cfg.claudeGen ?? generateWithClaude;

  const { items, signals } = await collect(cfg);
  const mood = judgeMood(signals, todayISO);
  const picked = pickCard(items, todayISO, rng);
  const relTimeStr = picked ? relTime(picked.date, todayISO) : null;
  const persona = await readFile(personaPath, 'utf8');
  const needDiary = mood === 'grumbly';
  const daysAway = signals.lastSignalISO ? diffDays(signals.lastSignalISO, todayISO) : 99;

  const gen = await claudeGen({ persona, mood, item: picked, relTimeStr, needDiary, daysAway });

  let card = null;
  if (picked) {
    const fc = gen?.cardTitle ? { cardTitle: gen.cardTitle, cardBody: gen.cardBody } : fallbackCard(picked, relTimeStr);
    card = {
      date: todayISO, title: fc.cardTitle, body: fc.cardBody,
      source: picked.kind, sourceDetail: picked.title, relTime: relTimeStr,
    };
    await writeCard(dataDir, card);
  }

  const prev = (await readState(dataDir)) ?? { diary: [] };
  const diary = [...(prev.diary ?? [])];
  if (needDiary) {
    diary.push({ date: todayISO, text: gen?.diary ?? fallbackDiary(rng) });
    while (diary.length > 14) diary.shift();
  }

  const state = {
    name: 'Cobbler',
    mood,
    mutter: gen?.mutter ?? fallbackMutter(mood, rng),
    diary,
    stats: {
      commits7d: signals.commits7d,
      learningsUpdated: signals.learningsThisWeek,
      lastSeen: signals.lastHeartbeatISO,
    },
    generatedAt: new Date().toISOString(),
  };
  await writeState(dataDir, state);
  return state;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const HOME = process.env.HOME;
  runPipeline({
    learningsDir: `${HOME}/Downloads/sync-bridge/cc-memory/learnings`,
    projectsDir: `${HOME}/Projects`,
    dataDir: new URL('./data', import.meta.url).pathname,
    personaPath: new URL('./persona.md', import.meta.url).pathname,
    todayISO: localDateISO(),
  }).then(
    (s) => { console.log(`[cobbler-nest] ok mood=${s.mood}`); },
    (e) => { console.error('[cobbler-nest] fail', e); process.exitCode = 1; },
  );
}
```

- [ ] **Step 4: 修正测试第一用例的 mood 断言为 `'calm'`(见 Step 1 注),跑测试确认通过** → PASS

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(nest): store + collect + 每日管线"`

---

### Task 8: server.js API

**Files:**
- Create: `nest/server.js`
- Test: `nest/test/server.test.js`

**Interfaces:**
- Consumes: `store.js` 全部读写函数,`localDateISO`
- Produces: `createServer({dataDir}) -> http.Server`;路由:GET `/api/state`、GET `/api/card/today`、GET `/api/cards?limit=N`、POST `/api/heartbeat`;CLI 直跑 bind `127.0.0.1:8790`(env `COBBLER_PORT`/`COBBLER_HOST` 可覆盖)

- [ ] **Step 1: 写失败测试**(随机端口真请求)`nest/test/server.test.js`

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.js';
import { writeState, writeCard } from '../lib/store.js';
import { localDateISO } from '../lib/dates.js';

const dataDir = await mkdtemp(join(tmpdir(), 'srv-'));
const server = createServer({ dataDir });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

test('GET /api/state: 无状态 404,有状态 200', async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 404);
  await writeState(dataDir, { name: 'Cobbler', mood: 'calm', mutter: 'm', diary: [], stats: {}, generatedAt: 'x' });
  const r = await fetch(`${base}/api/state`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mood, 'calm');
});

test('GET /api/card/today 与 /api/cards', async () => {
  assert.equal((await fetch(`${base}/api/card/today`)).status, 404);
  const today = localDateISO();
  await writeCard(dataDir, { date: today, title: 'T', body: 'B', source: 'learning', sourceDetail: 's', relTime: 'r' });
  await writeCard(dataDir, { date: '2026-01-01', title: 'OLD', body: 'B', source: 'learning', sourceDetail: 's', relTime: 'r' });
  assert.equal((await (await fetch(`${base}/api/card/today`)).json()).title, 'T');
  const cards = await (await fetch(`${base}/api/cards?limit=1`)).json();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, 'T'); // 倒序:今天在前
});

test('POST /api/heartbeat 落盘', async () => {
  const r = await fetch(`${base}/api/heartbeat`, { method: 'POST' });
  assert.deepEqual(await r.json(), { ok: true });
});

test('未知路由 404 JSON', async () => {
  const r = await fetch(`${base}/api/nope`);
  assert.equal(r.status, 404);
  assert.ok((await r.json()).error);
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现** `nest/server.js`

```js
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { readState, readCardByDate, listCards, appendHeartbeat } from './lib/store.js';
import { localDateISO } from './lib/dates.js';

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

export function createServer({ dataDir }) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const s = await readState(dataDir);
        return s ? send(res, 200, s) : send(res, 404, { error: 'no state yet' });
      }
      if (req.method === 'GET' && url.pathname === '/api/card/today') {
        const c = await readCardByDate(dataDir, localDateISO());
        return c ? send(res, 200, c) : send(res, 404, { error: 'no card today' });
      }
      if (req.method === 'GET' && url.pathname === '/api/cards') {
        const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 100);
        return send(res, 200, await listCards(dataDir, limit));
      }
      if (req.method === 'POST' && url.pathname === '/api/heartbeat') {
        await appendHeartbeat(dataDir, new Date().toISOString());
        return send(res, 200, { ok: true });
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: String(e) });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = new URL('./data', import.meta.url).pathname;
  const port = Number(process.env.COBBLER_PORT) || 8790;
  const host = process.env.COBBLER_HOST || '127.0.0.1';
  createServer({ dataDir }).listen(port, host, () => {
    console.log(`[cobbler-api] listening on ${host}:${port}`);
  });
}
```

- [ ] **Step 4: 跑全部测试** `npm test` → 全 PASS

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(nest): API 服务"`

---

### Task 9: launchd + install.sh + 真数据验收

**Files:**
- Create: `nest/launchd/com.alice.cobbler-nest.plist.tpl`, `nest/launchd/com.alice.cobbler-api.plist.tpl`, `nest/install.sh`, `README.md`(根,骨架)

**Interfaces:**
- Consumes: `generate.js` / `server.js` CLI 直跑入口
- Produces: 两个已装载的 launchd 服务;tailscale serve 暴露的 HTTPS 端点(app 端 BASE_URL)

- [ ] **Step 1: 写 plist 模板**(`__HOME__`/`__NODE__` 占位,install.sh 渲染;权限 644)

`nest/launchd/com.alice.cobbler-nest.plist.tpl`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.alice.cobbler-nest</string>
  <key>ProgramArguments</key>
  <array>
    <string>__NODE__</string>
    <string>__HOME__/Projects/cobbler/nest/generate.js</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
  <key>WorkingDirectory</key><string>__HOME__/Projects/cobbler/nest</string>
  <key>StandardOutPath</key><string>__HOME__/Projects/cobbler/nest/data/nest.log</string>
  <key>StandardErrorPath</key><string>__HOME__/Projects/cobbler/nest/data/nest.log</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>__HOME__/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict>
</plist>
```

`nest/launchd/com.alice.cobbler-api.plist.tpl`:同结构,Label `com.alice.cobbler-api`,ProgramArguments 跑 `server.js`,无 StartCalendarInterval,加 `<key>KeepAlive</key><true/>`,日志 `api.log`。

- [ ] **Step 2: 写 install.sh**(渲染模板 → `~/Library/LaunchAgents/` → chmod 644 → bootout+sleep+bootstrap;末尾打印 tailscale serve 配置命令与验收 curl)

```bash
#!/bin/bash
set -euo pipefail
NODE_BIN="$(command -v node)"
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/data"
for name in com.alice.cobbler-nest com.alice.cobbler-api; do
  sed -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$NODE_BIN|g" \
    "$DIR/launchd/$name.plist.tpl" > "$HOME/Library/LaunchAgents/$name.plist"
  chmod 644 "$HOME/Library/LaunchAgents/$name.plist"
  launchctl bootout "gui/$(id -u)/$name" 2>/dev/null || true
  sleep 3
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$name.plist"
done
echo "已装载。tailscale serve 暴露(按 mini 现状二选一):"
echo "  tailscale serve --bg --https=8443 http://127.0.0.1:8790   # 独立端口"
echo "  # 或挂路径(443 已被占时):tailscale serve --bg --set-path /cobbler http://127.0.0.1:8790"
echo "验收:curl -s http://127.0.0.1:8790/api/state | head -c 200"
```

- [ ] **Step 3: 装载并验证 launchd**

Run: `bash nest/install.sh && launchctl list | grep cobbler`
Expected: 两个 label 在列;`com.alice.cobbler-api` 有 PID

- [ ] **Step 4: 真数据跑一轮管线**

Run: `cd ~/Projects/cobbler/nest && node generate.js && cat data/state.json`
Expected: `[cobbler-nest] ok mood=...`;state.json 含真实 mutter;`data/cards/$(date +%F).json` 存在且素材来自真实 learnings/git

- [ ] **Step 5: 兜底验证(模拟 claude 不可用)**

Run: `COBBLER_TEST=1 node -e "…"` 方式不引入——直接临时改 PATH 使 claude 不可达跑一次:`PATH=/usr/bin:/bin node generate.js`(claude-gen 内部用绝对路径,故改用环境变量覆盖 claudeBin 的方式:在 generate.js CLI 入口读 `process.env.COBBLER_CLAUDE_BIN` 传入 opts;实现该 env 支持后跑 `COBBLER_CLAUDE_BIN=/nonexistent node generate.js`)
Expected: 依然 `ok mood=...`,mutter 来自模板池

- [ ] **Step 6: 配 tailscale serve 并从 tailnet 验证**

Run: install.sh 打印的其中一条(按 `tailscale serve status` 现状选);然后 `curl -sk https://mac-mini.tail791fb9.ts.net:8443/api/state | head -c 200`(或路径版对应 URL)
Expected: 与本地 curl 相同 JSON

- [ ] **Step 7: 根 README 骨架 + 最终 commit**

README.md(英文,含一句 what/architecture/quick start;README_CN.md 后补),然后:

```bash
git add -A && git commit -m "feat(nest): launchd 部署 + install 脚本 + README"
```

---

## Self-Review 记录

- **Spec 覆盖**:数据源两个 ✓ 选卡规则 ✓ 心情四态(含 sleepy 修正)✓ 模板兜底 ✓ diary cap14 ✓ heartbeats cap100 ✓ API 四端点 ✓ 原子写 ✓ launchd 644/bootout-sleep-bootstrap ✓ tailscale serve 双方案 ✓
- **占位符扫描**:无 TBD;Task 9 Step 5 的 COBBLER_CLAUDE_BIN env 是明确实现要求(generate.js CLI 入口加 `claudeGen` 的 bin 覆盖),非占位
- **类型一致性**:Item{date,kind,title,detail} 贯穿 parse-learnings/scan-git/pick-card/generate ✓;card 字段 server 与 store 一致 ✓;state 字段与 spec API 表一致 ✓
