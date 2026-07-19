import { cleanDisplay } from './museum-gen.js';

// 图源 = 大都会艺术博物馆(Met):图域 images.metmuseum.org 无盾,TG 服务器可直接抓
// (芝加哥艺术学院 artic 的 IIIF 图域有 Cloudflare 盾,TG/代理出口全被拦,2026-07-11 实测弃用)
const SEARCH_URL = 'https://collectionapi.metmuseum.org/public/collection/v1/search';
const OBJECT_URL = 'https://collectionapi.metmuseum.org/public/collection/v1/objects';
// Met search 必须带 q:主题轮换,每天先抽题再抽件
const THEMES = ['painting', 'landscape', 'portrait', 'flowers', 'garden', 'ceramics', 'textile', 'sculpture', 'print', 'armor', 'jewelry', 'musical instruments'];
const MAX_ID_TRIES = 6; // 个别对象无图/404,换 ID 重试
const MIN_HIGHLIGHT_POOL = 30; // 镇馆精选池小于这个数就退全量池(防 90 天去重吃紧)
const HDRS = { 'user-agent': 'cobbler-nest/1.0 (+https://github.com/AliceLJY/cobbler)', accept: 'application/json' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchIds(theme, { fetchImpl, timeoutMs, highlight }) {
  const url = `${SEARCH_URL}?hasImages=true&isPublicDomain=true${highlight ? '&isHighlight=true' : ''}&q=${encodeURIComponent(theme)}`;
  const res = await fetchImpl(url, { headers: HDRS, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`met search ${res.status}`);
  return (await res.json())?.objectIDs ?? [];
}

// Met object → 标准化藏品对象(gen/card 层不关心是哪家博物馆)
export function normalizeMetObject(o) {
  if (!o?.primaryImageSmall || !o?.title) return null;
  const artist = cleanDisplay([o.artistDisplayName, o.artistDisplayBio].filter(Boolean).join(' · ')) || null;
  return {
    id: o.objectID,
    title: o.title,
    artist,
    dateDisplay: o.objectDate || null,
    medium: o.medium || null,
    origin: o.culture || o.country || null,
    color: null, // Met API 无主色数据
    imageUrl: o.primaryImageSmall,
    museumUrl: o.objectURL || `https://www.metmuseum.org/art/collection/search/${o.objectID}`,
  };
}

export async function pickMuseumArtwork({ history = [], rng = Math.random, fetchImpl = fetch, timeoutMs = 20000, retryDelayMs = 1500 } = {}) {
  const theme = THEMES[Math.floor(rng() * THEMES.length)];
  // 先抽镇馆精选(isHighlight,各主题实测 100-950 件),池太小才退全量——每天都该是件好东西
  let ids = await searchIds(theme, { fetchImpl, timeoutMs, highlight: true });
  if (ids.length < MIN_HIGHLIGHT_POOL) {
    ids = await searchIds(theme, { fetchImpl, timeoutMs, highlight: false });
  }
  if (!ids.length) throw new Error(`met search empty for "${theme}"`);

  const seen = new Set(history);
  const freshIds = ids.filter((id) => !seen.has(id));
  const pool = freshIds.length ? freshIds : ids; // 全撞历史放开重复,永不空手
  const remainingIds = [...new Set(pool)];
  const retryableIds = [];
  const errorsById = new Map();

  for (let i = 0; i < MAX_ID_TRIES && (remainingIds.length || retryableIds.length); i++) {
    if (i > 0) await sleep(retryDelayMs); // 失败换件时歇口气,别背靠背打
    if (!remainingIds.length) remainingIds.push(...new Set(retryableIds.splice(0)));
    const [id] = remainingIds.splice(Math.floor(rng() * remainingIds.length), 1);
    try {
      const r = await fetchImpl(`${OBJECT_URL}/${id}`, { headers: HDRS, signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`met object ${r.status}`);
      errorsById.delete(id);
      const norm = normalizeMetObject(await r.json());
      if (norm) return norm;
    } catch (e) {
      errorsById.set(id, e);
      retryableIds.push(id);
    }
  }
  if (errorsById.size) throw [...errorsById.values()].at(-1);
  return null;
}
