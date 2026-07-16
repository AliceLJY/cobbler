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
      if (s.isDirectory() || s.isFile()) repos.push(join(projectsDir, name));
    } catch { /* not a repo */ }
  }
  return repos;
}

async function repoCommits(repoPath) {
  try {
    const { stdout } = await pexec(
      'git', ['log', '--pretty=%ad%x09%ae%x09%an%x09%s', '--date=format:%Y-%m-%d'],
      { cwd: repoPath, maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout.split('\n').filter(Boolean).map((line) => {
      const [date, email, name, ...rest] = line.split('\t');
      return { date, email, name, subject: rest.join('\t') };
    });
  } catch { return []; } // 空仓库/坏仓库跳过
}

function isHers(commit, authors) {
  if (!authors) return true; // 不传过滤器 = 不过滤
  const email = (commit.email ?? '').toLowerCase();
  const name = (commit.name ?? '').toLowerCase();
  const expectedEmail = (authors.email ?? '').toLowerCase();
  const expectedName = (authors.name ?? '').toLowerCase();
  return Boolean(
    (expectedEmail && email === expectedEmail)
    || (expectedName && name === expectedName),
  );
}

export async function scanGit(projectsDir, todayISO, { authors } = {}) {
  const repos = await listRepos(projectsDir);
  const items = [];
  let commits7d = 0;
  let lastCommitDate = null;
  for (const repo of repos) {
    const repoName = repo.split('/').at(-1);
    for (const c of await repoCommits(repo)) {
      // clone 的别人仓库/别人的 commit 不是她的历史,也不算她的活跃
      if (!isHers(c, authors)) continue;
      items.push({ date: c.date, kind: 'commit', title: c.subject, detail: repoName });
      const d = diffDays(c.date, todayISO);
      if (d >= 0 && d < 7) commits7d += 1;
      if (!lastCommitDate || c.date > lastCommitDate) lastCommitDate = c.date;
    }
  }
  return { commits7d, lastCommitDate, items };
}
