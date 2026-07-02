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

test('单位自适应:m/s² 读数(静止≈9.8)自动归一,走路仍触发 bouncing', () => {
  const m = createPetMachine();
  const G = 9.80665;
  let samples: Sample[] = [];
  for (let i = 0; i < 5; i++) {
    samples.push(
      { x: 0, y: 0, z: (1 + 0.3) * G, t: i * 500 },
      { x: 0, y: 0.3 * G, z: G, t: i * 500 + 100 },
      { x: 0, y: 0.3 * G, z: G, t: i * 500 + 200 },
    );
  }
  assert.equal(run(m, samples), 'bouncing');
});

test('粘性锁:m/s² 设备失重相位(rawMag<4)不撕裂波形、深谷不误判摇晃', () => {
  const m = createPetMachine();
  const G = 9.80665;
  // 先喂一帧静止(rawMag≈9.8)锁定 m/s²
  m.feed({ x: 0.1, y: 0.1, z: G, t: 0 });
  // Alice 实测走路波形:高峰 ~13 m/s² 与深谷 ~3.27 m/s² 交替(锁定后深谷 dev≈0.67,不该算 shake)
  let samples: Sample[] = [];
  for (let i = 0; i < 6; i++) {
    const base = 300 + i * 500;
    samples.push(
      { x: 0, y: 0, z: 13, t: base },            // 撞击高峰 dev≈0.33
      { x: 0, y: 0, z: G, t: base + 120 },       // 回落 re-arm
      { x: 0, y: 0, z: 3.27, t: base + 250 },    // 失重深谷 dev≈0.67(<0.9 仍是步峰)
      { x: 0, y: 0, z: G, t: base + 380 },       // 回落 re-arm
    );
  }
  const last = run(m, samples);
  assert.equal(last, 'bouncing'); // 步峰连续 → 颠,绝不是 dizzy
});

test('单位自适应:m/s² 放平 3s → sleeping', () => {
  const m = createPetMachine();
  const samples: Sample[] = [];
  for (let t = 0; t < 3500; t += 100) samples.push({ x: 0.1, y: 0.15, z: 9.81, t });
  assert.equal(run(m, samples), 'sleeping');
});

test('摇晃:持续高能量 1s → dizzy,并保持 4s(优先于放平)', () => {
  const m = createPetMachine();
  // 摇晃波形:10Hz 采样,dev 在 0.6~1.4 连续波动 1.2s(不依赖离散峰)
  const samples: Sample[] = [];
  for (let t = 0; t <= 1200; t += 100) {
    const dev = 0.6 + 0.8 * Math.abs(Math.sin(t / 80));
    samples.push({ x: 0, y: 0, z: 1 + dev, t });
  }
  assert.equal(run(m, samples), 'dizzy');
  // 立刻放平:dizzy 未过期,仍 dizzy
  assert.equal(run(m, flat(1300, 2000)), 'dizzy');
  // dizzy 过期后继续放平 → sleeping
  assert.equal(run(m, flat(3300, 4500)), 'sleeping');
});

test('走路脉冲波形高能量占比低,不误判摇晃', () => {
  const m = createPetMachine();
  // 走路:每 500ms 一个短脉冲峰(dev 1.0,仅 1 帧),其余低能量
  let samples: Sample[] = [];
  for (let i = 0; i < 8; i++) {
    const base = i * 500;
    samples.push({ x: 0, y: 0, z: 2.0, t: base });          // 峰 dev 1.0
    for (let dt = 100; dt < 500; dt += 100) {
      samples.push({ x: 0, y: 0.25, z: 1, t: base + dt });  // 谷,手持微动
    }
  }
  assert.equal(run(m, samples), 'bouncing'); // 是颠,不是晕
});
