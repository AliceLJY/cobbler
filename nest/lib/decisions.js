import { chmod, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readJSON, writeJSONAtomic } from './store.js';

// 票拟加批红(2026-11-02,借鉴卡兹克那篇判据 3):Agent 把建议写成决定卡片,Alice 只点按钮。
// 决策记录 data/decisions/<id>.json 只存状态与数据,不存任何命令——点了之后执行什么,由 kind 在代码里写死。
// 设计与三轮互审见 sync-bridge AI产出/2026-11-02-票拟批红/plan.md。
export const KINDS = {
  'autopub-release': { options: [['go', '发'], ['later', '改天'], ['no', '不发']] },
  ping: { options: [['ok', '好'], ['no', '不好']] }, // 只用来验按钮手感,不触发任何执行
};

export const ID_RE = /^[a-z0-9]{6,16}$/;
const CB_RE = /^d:([a-z0-9]{6,16}):([a-z]{1,8})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLOT_RE = /^\d{2}:\d{2}$/;
const KEY_RE = /^(视频号|快手)\|(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})\|[^|]{1,20}$/;
const FP_RE = /^[0-9a-f]{16}$/;

export function newId(nowMs = Date.now()) {
  return nowMs.toString(36) + randomBytes(2).toString('hex');
}

export function cbData(id, key) {
  const s = `d:${id}:${key}`;
  if (Buffer.byteLength(s) > 64) throw new Error(`callback_data 超过 64 字节: ${s}`);
  return s;
}

export function parseCb(s) {
  const m = CB_RE.exec(s ?? '');
  return m ? { id: m[1], key: m[2] } : null;
}

export function hasOption(kind, key) {
  return Boolean(KINDS[kind]?.options.some(([k]) => k === key));
}

export function optionLabel(kind, key) {
  return KINDS[kind]?.options.find(([k]) => k === key)?.[1] ?? key;
}

export function keyboard(d) {
  return { inline_keyboard: [KINDS[d.kind].options.map(([k, text]) => ({ text, callback_data: cbData(d.id, k) }))] };
}

// 返回错误描述;null = 合格。payload 是她批准的对象,宁可拒收也不放宽。
export function validatePayload(kind, p) {
  if (!KINDS[kind]) return `未知 kind: ${kind}`;
  if (kind === 'ping') return null;
  if (!p || typeof p !== 'object') return 'payload 缺失';
  if (!DATE_RE.test(p.date ?? '')) return 'date 格式不对';
  if (!SLOT_RE.test(p.slot ?? '')) return 'slot 格式不对';
  if (p.dryRun != null && typeof p.dryRun !== 'boolean') return 'dryRun 必须是布尔值';
  if (!Array.isArray(p.entries) || p.entries.length < 1 || p.entries.length > 6) return 'entries 要 1–6 条';
  for (const e of p.entries) {
    const m = KEY_RE.exec(e?.key ?? '');
    if (!m) return `key 格式不对: ${e?.key}`;
    if (m[1] !== e.platform || m[2] !== p.date || m[3] !== p.slot) return `key 与 platform/date/slot 对不上: ${e.key}`;
    if (!FP_RE.test(e.fp ?? '')) return `fp 格式不对: ${e.key}`;
    if (typeof e.name !== 'string' || !e.name || e.name.length > 80) return `name 不合格: ${e.key}`;
  }
  return null;
}

// 次日 hh:mm(东八区),不依赖进程时区:launchd 下 bot 没有设 TZ。
export function nextDayAt(nowMs, hh = 18, mm = 15, offsetMin = 480) {
  const local = new Date(nowMs + offsetMin * 60000);
  const utc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, hh, mm);
  return new Date(utc - offsetMin * 60000).toISOString();
}

const dirOf = (dataDir) => join(dataDir, 'decisions');

export async function loadDecision(dataDir, id) {
  if (!ID_RE.test(id ?? '')) return null;
  return readJSON(join(dirOf(dataDir), `${id}.json`), null);
}

export async function saveDecision(dataDir, d) {
  await mkdir(dirOf(dataDir), { recursive: true, mode: 0o700 });
  const file = join(dirOf(dataDir), `${d.id}.json`);
  await writeJSONAtomic(file, d);
  await chmod(file, 0o600);
  return d;
}

export async function listDecisions(dataDir) {
  let names = [];
  try { names = await readdir(dirOf(dataDir)); } catch { return []; }
  const out = [];
  for (const n of names.filter((x) => x.endsWith('.json')).sort()) {
    const d = await readJSON(join(dirOf(dataDir), n), null);
    if (d?.id) out.push(d);
  }
  return out;
}
