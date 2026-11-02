// 票拟入口:把一张决策卡发给 Alice(带按钮),落一条 pending 记录。
// 用法:echo '{"kind":"autopub-release","text":"…","payload":{…}}' | node nest/ask.js [--data-dir <dir>]
// stdout {"id":"…","messageId":…};退出码 0 成功 / 1 发送失败(记录标 failed,不留 pending)/ 2 输入不合格。
// 卡片文字由调用方拼好:node 在 launchd 下读不了 ~/Downloads 里的清单,能读清单的那一侧(python)负责写字。
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON } from './lib/store.js';
import { keyboard, newId, saveDecision, validatePayload, KINDS } from './lib/decisions.js';
import { sendTelegramMessage } from './lib/tg-send.js';

export async function ask(input, { dataDir, sendImpl = sendTelegramMessage, now = () => Date.now() }) {
  const { kind, text, payload = {} } = input ?? {};
  if (!KINDS[kind]) return { code: 2, error: `未知 kind: ${kind}` };
  if (typeof text !== 'string' || !text.trim() || text.length > 3500) return { code: 2, error: 'text 为空或超过 3500 字' };
  const bad = validatePayload(kind, payload);
  if (bad) return { code: 2, error: bad };
  const tg = await readJSON(join(dataDir, 'tg.json'), null);
  if (!tg?.token || !tg?.chatId) return { code: 1, error: 'tg.json 缺 token/chatId' };

  const d = { id: newId(now()), kind, text, payload, chatId: tg.chatId, status: 'pending', createdAt: now(), messageId: null };
  await saveDecision(dataDir, d);
  try {
    const sent = await sendImpl({ token: tg.token, chatId: tg.chatId, text, replyMarkup: keyboard(d) });
    d.messageId = sent?.message_id ?? null;
    await saveDecision(dataDir, d);
    return { code: 0, id: d.id, messageId: d.messageId };
  } catch (e) {
    Object.assign(d, { status: 'failed', result: { outcome: 'failed', lines: ['卡片没发出去'] }, notified: true });
    await saveDecision(dataDir, d);
    return { code: 1, error: `发送失败: ${e?.message ?? e}` };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--data-dir');
  const dataDir = i > 0 ? process.argv[i + 1] : new URL('./data', import.meta.url).pathname;
  let input;
  try { input = JSON.parse(await readFile('/dev/stdin', 'utf8')); } catch (e) {
    console.error(`ask: stdin 不是 JSON: ${e.message}`); process.exit(2);
  }
  const r = await ask(input, { dataDir });
  if (r.code) { console.error(`ask: ${r.error}`); process.exit(r.code); }
  console.log(JSON.stringify({ id: r.id, messageId: r.messageId }));
}
