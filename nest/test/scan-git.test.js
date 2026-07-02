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

test('scanGit 按 author 过滤:clone 的别人仓库历史不算她的', async () => {
  const root = await mkdtemp(join(tmpdir(), 'proj-'));
  const repo = join(root, 'cloned');
  await mkdir(repo);
  git(repo, ['init', '-b', 'main'], '2026-07-01');
  await writeFile(join(repo, 'a.txt'), '1');
  git(repo, ['add', '.'], '2026-07-01');
  // 别人的 commit(近 7 天内)
  execFileSync('git', ['-c', 'user.email=ben@other.dev', '-c', 'user.name=Ben', 'commit', '-m', 'their merge'], {
    cwd: repo,
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-07-01T12:00:00', GIT_COMMITTER_DATE: '2026-07-01T12:00:00' },
  });
  await writeFile(join(repo, 'a.txt'), '2');
  git(repo, ['add', '.'], '2026-07-01');
  // 她的 commit(用测试身份 t@t / t)
  git(repo, ['commit', '-m', 'her fix'], '2026-06-30');

  const r = await scanGit(root, '2026-07-02', { authors: { email: 't@t', name: 't' } });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].title, 'her fix');
  assert.equal(r.commits7d, 1); // 别人的 7 天内 commit 不算她的活跃
  assert.equal(r.lastCommitDate, '2026-06-30');
});

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
