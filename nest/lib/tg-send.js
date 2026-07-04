const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function sendTelegramMessage({ token, chatId, text }, opts = {}) {
  const { fetchImpl = fetch, retries = 3, baseDelayMs = 2000, timeoutMs = 15000 } = opts;
  if (!token || !chatId) throw new Error('tg-send: missing token/chatId');
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) return body.result;
      lastErr = new Error(`tg-send: api not ok (${res.status}) ${body.description ?? ''}`);
    } catch (e) { lastErr = e; }
    if (i < retries - 1) await sleep(baseDelayMs * 2 ** i);
  }
  throw lastErr;
}

export function formatHippoCardText(card, dateISO) {
  const [, m, d] = dateISO.split('-');
  return [
    `🥚 知识扭蛋 · ${Number(m)}月${Number(d)}日`,
    '',
    `「${card.pageTitle}」`,
    '',
    card.body,
    '',
    card.question,
    '',
    `—— ${card.mutter}`,
  ].join('\n');
}
