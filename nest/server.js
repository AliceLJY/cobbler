import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { readState, readCardByDate, listCards, appendHeartbeat } from './lib/store.js';
import { localDateISO } from './lib/dates.js';

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

export function createServer({ dataDir, onMissingToday }) {
  let generating = false;
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const s = await readState(dataDir);
        return s ? send(res, 200, s) : send(res, 404, { error: 'no state yet' });
      }
      if (req.method === 'GET' && url.pathname === '/api/card/today') {
        const c = await readCardByDate(dataDir, localDateISO());
        if (c) return send(res, 200, c);
        // 今日卡缺失(mini 睡过 7:30 等) → 惰性补跑一轮管线,自愈
        if (onMissingToday && !generating) {
          generating = true;
          Promise.resolve(onMissingToday()).finally(() => { generating = false; });
        }
        return send(res, 404, { error: 'no card today', generating: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/cards') {
        const requested = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
        const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 30;
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
  const HOME = process.env.HOME;
  const onMissingToday = async () => {
    const { runPipeline } = await import('./generate.js');
    const { localDateISO: today } = await import('./lib/dates.js');
    console.log('[cobbler-api] today card missing, lazy-generating…');
    await runPipeline({
      learningsDir: `${HOME}/Downloads/sync-bridge/cc-memory/learnings`,
      projectsDir: `${HOME}/Projects`,
      dataDir,
      personaPath: new URL('./persona.md', import.meta.url).pathname,
      todayISO: today(),
    }).catch((e) => console.error('[cobbler-api] lazy generate failed', e));
  };
  createServer({ dataDir, onMissingToday }).listen(port, host, () => {
    console.log(`[cobbler-api] listening on ${host}:${port}`);
  });
}
