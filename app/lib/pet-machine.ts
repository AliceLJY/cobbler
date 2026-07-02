export type Pose = 'idle' | 'sleeping' | 'bouncing' | 'dizzy';
export type Sample = { x: number; y: number; z: number; t: number }; // 单位 g / ms

// 阈值(g)。纸上初值,真机调参入口集中在这里。
const FLAT_Z = [0.85, 1.15] as const;
const FLAT_XY = 0.12;
const SLEEP_AFTER_MS = 3000;
const PEAK_ARM_BELOW = 0.35;   // 回落到此以下即可记下一峰(0.1 会在持续摇晃中永不 re-arm)
const STEP_DEV = 0.18;         // 步峰下限
const STEP_GAP = [200, 1000] as const; // 一步产生高峰+深谷两峰,4Hz 峰频
const STEPS_TO_BOUNCE = 3;     // 3 连击即颠,手感更快
const BOUNCE_HOLD_MS = 2000;
// 摇晃 = 能量占比判据(数峰对手法太敏感:峰值不够线或节奏不合窗口都漏检)
const DIZZY_ENERGY_DEV = 0.5;  // "高能量"样本门槛
const DIZZY_WINDOW_MS = 1000;
const DIZZY_RATIO = 0.6;       // 窗口内高能量占比 ≥60% 判摇晃(走路脉冲式占比 ~25%)
const DIZZY_MIN_SAMPLES = 6;
const DIZZY_HOLD_MS = 4000;

export function createPetMachine() {
  let flatSince: number | null = null;
  let armed = true;            // 峰检测去抖
  let lastStepAt: number | null = null;
  let stepStreak = 0;
  let bouncingUntil = -1;
  let dizzyUntil = -1;
  let msq = false;             // 单位粘性锁:见过幅值>4 即永久判定 m/s² 设备
  let lastMag = 1;
  let lastDev = 0;
  let lastRawMag = 1;
  let recentDevs: { t: number; dev: number }[] = [];

  function feed(rawSample: Sample): Pose {
    // 单位自适应(粘性):部分 Android 设备实际回报 m/s²(静止≈9.8)而非文档所称的 g。
    // g 设备人力极限 ~3g 永远到不了 4;m/s² 设备静止即 9.8,首秒必锁定。
    // 锁定必须粘性:m/s² 设备在走路失重相位瞬时幅值可低于 4,逐样本判断会撕裂波形。
    const rawMag = Math.hypot(rawSample.x, rawSample.y, rawSample.z);
    if (rawMag > 4) msq = true;
    const k = msq ? 1 / 9.80665 : 1;
    const s = k === 1 ? rawSample : { x: rawSample.x * k, y: rawSample.y * k, z: rawSample.z * k, t: rawSample.t };
    const mag = rawMag * k;
    const dev = Math.abs(mag - 1);
    lastMag = mag;
    lastDev = dev;
    lastRawMag = rawMag;

    // 步峰检测(上穿 + 去抖)
    if (armed && dev >= STEP_DEV) {
      armed = false;
      const gap = lastStepAt === null ? null : s.t - lastStepAt;
      stepStreak = gap !== null && gap >= STEP_GAP[0] && gap <= STEP_GAP[1] ? stepStreak + 1 : 1;
      lastStepAt = s.t;
      if (stepStreak >= STEPS_TO_BOUNCE) bouncingUntil = s.t + BOUNCE_HOLD_MS;
    } else if (dev < PEAK_ARM_BELOW) {
      armed = true;
    }

    // 摇晃检测(能量占比)
    recentDevs.push({ t: s.t, dev });
    recentDevs = recentDevs.filter((r) => s.t - r.t <= DIZZY_WINDOW_MS);
    if (recentDevs.length >= DIZZY_MIN_SAMPLES) {
      const hot = recentDevs.filter((r) => r.dev > DIZZY_ENERGY_DEV).length;
      if (hot / recentDevs.length >= DIZZY_RATIO) {
        dizzyUntil = s.t + DIZZY_HOLD_MS;
        stepStreak = 0;
        lastStepAt = null;
        bouncingUntil = -1;
      }
    }

    // 放平计时
    const isFlat =
      Math.abs(s.z) >= FLAT_Z[0] && Math.abs(s.z) <= FLAT_Z[1] &&
      Math.abs(s.x) < FLAT_XY && Math.abs(s.y) < FLAT_XY;
    if (isFlat) flatSince = flatSince ?? s.t;
    else flatSince = null;

    // 优先级:dizzy > sleeping > bouncing > idle
    if (s.t < dizzyUntil) return 'dizzy';
    if (flatSince !== null && s.t - flatSince >= SLEEP_AFTER_MS) return 'sleeping';
    if (s.t < bouncingUntil) return 'bouncing';
    return 'idle';
  }

  function debug() {
    return { mag: lastMag, dev: lastDev, rawMag: lastRawMag, msq };
  }

  return { feed, debug };
}
