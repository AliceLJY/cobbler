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
