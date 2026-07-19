import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMuseumCard } from '../museum-card.js';

test('无可用藏品时终止,不继续生成卡片', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'cobbler-museum-'));
  let generated = false;
  await assert.rejects(
    runMuseumCard({
      dataDir,
      personaPath: join(dataDir, 'persona.md'),
      todayISO: '2026-07-02',
      museumPick: async () => null,
      museumGen: async () => { generated = true; },
    }),
    /museum-card: nothing to pick/,
  );
  assert.equal(generated, false);
});
