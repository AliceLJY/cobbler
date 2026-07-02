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
