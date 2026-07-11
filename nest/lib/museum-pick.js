const SEARCH_URL = 'https://api.artic.edu/api/v1/artworks/search';
const FIELDS = 'id,title,artist_display,date_display,medium_display,place_of_origin,color,image_id';
const PAGE_LIMIT = 12;
// search 结果窗口 limit×page ≲1000,超了报 403 "too many results"(2026-07-11 实测 page=400 被拒)。
// 80×12=960:池子=按热度排最靠前的 960 件公版名作,配 90 天去重约两年半不重样,够用且都是好东西
const MAX_PAGE = 80;
const MAX_TRIES = 3;

export function museumImageUrl(imageId) {
  return `https://www.artic.edu/iiif/2/${imageId}/full/843,/0/default.jpg`;
}

export function pickFromPage(items, history, rng = Math.random) {
  const seen = new Set(history);
  const fresh = (items ?? []).filter((a) => a?.image_id && a?.title && !seen.has(a.id));
  if (!fresh.length) return null;
  return fresh[Math.floor(rng() * fresh.length)];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pickMuseumArtwork({ history = [], rng = Math.random, fetchImpl = fetch, timeoutMs = 20000, retryDelayMs = 1500 } = {}) {
  let lastErr = null;
  const fallbackPool = [];
  for (let i = 0; i < MAX_TRIES; i++) {
    // artic 接入层偶发 403/超时(瞬时风控),轮次间退避别背靠背打
    if (i > 0) await sleep(retryDelayMs * 2 ** (i - 1));
    const page = 1 + Math.floor(rng() * MAX_PAGE);
    let items;
    try {
      const res = await fetchImpl(
        `${SEARCH_URL}?query[term][is_public_domain]=true&fields=${FIELDS}&limit=${PAGE_LIMIT}&page=${page}`,
        {
          headers: { 'user-agent': 'cobbler-nest/1.0 (+https://github.com/AliceLJY/cobbler)', accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (!res.ok) throw new Error(`artic api ${res.status}`);
      items = (await res.json())?.data ?? [];
    } catch (e) { lastErr = e; continue; }
    fallbackPool.push(...items.filter((a) => a?.image_id && a?.title));
    const hit = pickFromPage(items, history, rng);
    if (hit) return hit;
  }
  // 几页全撞历史:放开重复,永不空手(仿 pickHippoPage 回退)
  if (fallbackPool.length) return fallbackPool[Math.floor(rng() * fallbackPool.length)];
  if (lastErr) throw lastErr;
  return null;
}
