import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMuseumArtwork, normalizeMetObject } from '../lib/museum-pick.js';

const MET_OBJ = (id, over = {}) => ({
  objectID: id,
  title: `T${id}`,
  artistDisplayName: 'Claude Monet',
  artistDisplayBio: 'French, 1840–1926',
  objectDate: '1906',
  medium: 'Oil on canvas',
  culture: '',
  country: 'France',
  primaryImageSmall: `https://images.metmuseum.org/web-large/${id}.jpg`,
  objectURL: `https://www.metmuseum.org/art/collection/search/${id}`,
  ...over,
});

// 两跳假实现:search 返回 ids(highlight/全量可分别指定),objects/{id} 返回对象
const metFetch = (ids, objects = {}, highlightIds = null) => async (url) => {
  if (url.includes('/search')) {
    const pool = url.includes('isHighlight=true') ? (highlightIds ?? ids) : ids;
    return { ok: true, json: async () => ({ objectIDs: pool }) };
  }
  const id = Number(url.split('/').pop());
  const obj = objects[id] ?? MET_OBJ(id);
  return { ok: true, json: async () => obj };
};

test('normalizeMetObject 拼作者+bio,补馆藏页,Met 无主色', () => {
  const n = normalizeMetObject(MET_OBJ(1));
  assert.equal(n.artist, 'Claude Monet · French, 1840–1926');
  assert.equal(n.dateDisplay, '1906');
  assert.equal(n.origin, 'France'); // culture 空时用 country
  assert.equal(n.color, null);
  assert.ok(n.imageUrl.includes('images.metmuseum.org'));
  assert.ok(n.museumUrl.includes('/search/1'));
});

test('normalizeMetObject 无图/无题 → null', () => {
  assert.equal(normalizeMetObject(MET_OBJ(1, { primaryImageSmall: '' })), null);
  assert.equal(normalizeMetObject(MET_OBJ(1, { title: '' })), null);
  assert.equal(normalizeMetObject(null), null);
});

test('成功路径:search 抽题 → 随机 ID → 标准化藏品', async () => {
  const r = await pickMuseumArtwork({ rng: () => 0.5, fetchImpl: metFetch([11, 22, 33]) });
  assert.equal(r.id, 22);
  assert.equal(r.title, 'T22');
});

test('history 滤 ID:已抽过的不再抽', async () => {
  const r = await pickMuseumArtwork({ history: [11, 22], rng: () => 0, fetchImpl: metFetch([11, 22, 33]) });
  assert.equal(r.id, 33);
});

test('全撞历史 → 放开重复,永不空手', async () => {
  const r = await pickMuseumArtwork({ history: [11], rng: () => 0, fetchImpl: metFetch([11]) });
  assert.equal(r.id, 11);
});

test('抽到无图对象 → 换 ID 重试拿到有图的', async () => {
  const objectCalls = [];
  const fetchImpl = async (url) => {
    if (url.includes('/search')) return { ok: true, json: async () => ({ objectIDs: [7, 8] }) };
    const id = Number(url.split('/').pop());
    objectCalls.push(id);
    return { ok: true, json: async () => (id === 7 ? MET_OBJ(7, { primaryImageSmall: '' }) : MET_OBJ(id)) };
  };
  const r = await pickMuseumArtwork({ rng: () => 0, fetchImpl, retryDelayMs: 1 });
  assert.equal(r.id, 8);
  assert.deepEqual(objectCalls, [7, 8]);
});

test('highlight 池 ≥30 → 用精品池,不再打全量', async () => {
  const highlightIds = Array.from({ length: 30 }, (_, i) => 100 + i);
  let fullSearchCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/search')) {
      if (url.includes('isHighlight=true')) return { ok: true, json: async () => ({ objectIDs: highlightIds }) };
      fullSearchCalls++;
      return { ok: true, json: async () => ({ objectIDs: [999] }) };
    }
    return { ok: true, json: async () => MET_OBJ(Number(url.split('/').pop())) };
  };
  const r = await pickMuseumArtwork({ rng: () => 0, fetchImpl });
  assert.equal(r.id, 100);
  assert.equal(fullSearchCalls, 0);
});

test('highlight 池 <30 → 退全量池', async () => {
  const r = await pickMuseumArtwork({ rng: () => 0, fetchImpl: metFetch([55], {}, [1]) });
  assert.equal(r.id, 55); // highlight 只有 1 件(<30),用了全量的 55
});

test('search 失败 → throw;object 持续失败 → throw', async () => {
  await assert.rejects(
    pickMuseumArtwork({ fetchImpl: async () => ({ ok: false, status: 502 }), rng: () => 0 }),
    /met search 502/,
  );
  const fetchImpl = async (url) => (url.includes('/search')
    ? { ok: true, json: async () => ({ objectIDs: [1] }) }
    : { ok: false, status: 404 });
  await assert.rejects(pickMuseumArtwork({ fetchImpl, rng: () => 0, retryDelayMs: 1 }), /met object 404/);
});
