import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFromPage, pickMuseumArtwork, museumImageUrl } from '../lib/museum-pick.js';

const A = (id, over = {}) => ({ id, title: `T${id}`, image_id: `img-${id}`, ...over });

test('museumImageUrl 拼 IIIF 843 宽标准 URL', () => {
  assert.equal(museumImageUrl('abc'), 'https://www.artic.edu/iiif/2/abc/full/843,/0/default.jpg');
});

test('pickFromPage 滤无图/无题/已在历史', () => {
  const items = [A(1), A(2, { image_id: null }), A(3, { title: '' }), A(4)];
  const r = pickFromPage(items, [1], () => 0);
  assert.equal(r.id, 4);
});

test('pickFromPage 全撞历史 → null(回退在上层)', () => {
  assert.equal(pickFromPage([A(1)], [1], () => 0), null);
});

test('pickMuseumArtwork 成功:从页里挑 fresh 一件', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ data: [A(1), A(2)] }) });
  const r = await pickMuseumArtwork({ history: [1], rng: () => 0.5, fetchImpl });
  assert.equal(r.id, 2);
});

test('pickMuseumArtwork 全撞历史 → 放开重复,永不空手', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ data: [A(1)] }) });
  const r = await pickMuseumArtwork({ history: [1], rng: () => 0, fetchImpl });
  assert.equal(r.id, 1);
});

test('API 持续失败 → throw 最后一个错误', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  await assert.rejects(pickMuseumArtwork({ fetchImpl, rng: () => 0, retryDelayMs: 1 }), /artic api 500/);
});

test('首轮失败次轮成功:重试真的在工作', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls === 1
    ? { ok: false, status: 403 }
    : { ok: true, json: async () => ({ data: [A(7)] }) });
  const r = await pickMuseumArtwork({ fetchImpl, rng: () => 0, retryDelayMs: 1 });
  assert.equal(r.id, 7);
  assert.equal(calls, 2);
});
