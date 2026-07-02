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
