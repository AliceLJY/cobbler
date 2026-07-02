import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadLearnings } from './lib/parse-learnings.js';
import { scanGit } from './lib/scan-git.js';
import { readJSON } from './lib/store.js';
import { diffDays, localDateISO } from './lib/dates.js';

const pexec = promisify(execFile);

async function gitIdentity() {
  try {
    const [email, name] = await Promise.all([
      pexec('git', ['config', '--global', 'user.email']).then((r) => r.stdout.trim()),
      pexec('git', ['config', '--global', 'user.name']).then((r) => r.stdout.trim()),
    ]);
    return email && name ? { email, name } : null;
  } catch { return null; }
}

export async function collect({ learningsDir, projectsDir, dataDir, todayISO, authors }) {
  const learnings = await loadLearnings(learningsDir);
  const git = await scanGit(projectsDir, todayISO, { authors: authors ?? await gitIdentity() });
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
