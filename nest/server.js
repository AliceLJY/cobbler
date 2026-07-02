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
