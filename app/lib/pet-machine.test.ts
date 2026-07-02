import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPetMachine, type Sample } from './pet-machine.ts';

// 采样流构造:每 100ms 一个样本
function run(machine: ReturnType<typeof createPetMachine>, samples: Sample[]) {
  let last = 'idle';
  for (const s of samples) last = machine.feed(s);
  return last;
}

function flat(from: number, ms: number): Sample[] {
  const out: Sample[] = [];
  for (let t = from; t < from + ms; t += 100) out.push({ x: 0.01, y: 0.02, z: 1.0, t });
  return out;
}

// 一个"峰":上冲一帧再回落两帧(帧间 100ms)
function peak(t: number, dev: number): Sample[] {
  return [
    { x: 0, y: 0, z: 1 + dev, t },
    { x: 0, y: 0.3, z: 1, t: t + 100 },       // handheld 抖动,非 flat
    { x: 0, y: 0.3, z: 1, t: t + 200 },
  ];
}

test('放平 3s → sleeping', () => {
  const m = createPetMachine();
  assert.equal(run(m, flat(0, 2900)), 'idle');
  assert.equal(run(m, flat(2900, 500)), 'sleeping');
});

test('走路:4 个规律步峰 → bouncing;停 2s → idle', () => {
  const m = createPetMachine();
  let samples: Sample[] = [];
  for (let i = 0; i < 5; i++) samples.push(...peak(i * 500, 0.3));
  assert.equal(run(m, samples), 'bouncing');
  // 停止走动(手持微动、非放平),2.5s 后回 idle
  const idleAfter: Sample[] = [];
  for (let t = 2700; t < 5300; t += 100) idleAfter.push({ x: 0, y: 0.3, z: 1, t });
  assert.equal(run(m, idleAfter), 'idle');
});

test('步峰间隔过长不触发 bouncing', () => {
  const m = createPetMachine();
  let samples: Sample[] = [];
  for (let i = 0; i < 5; i++) samples.push(...peak(i * 1500, 0.3));
  assert.equal(run(m, samples), 'idle');
});

test('摇晃:1.2s 内 3 个剧烈峰 → dizzy,并保持 4s(优先于放平)', () => {
  const m = createPetMachine();
  let samples: Sample[] = [];
  for (let i = 0; i < 3; i++) samples.push(...peak(i * 300, 0.9));
  assert.equal(run(m, samples), 'dizzy');
  // 立刻放平:dizzy 未过期,仍 dizzy
  assert.equal(run(m, flat(1000, 2000)), 'dizzy');
  // dizzy 过期后继续放平满 3s → sleeping
  assert.equal(run(m, flat(3000, 4500)), 'sleeping');
});
