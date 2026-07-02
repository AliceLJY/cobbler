import { useEffect, useRef, useState } from 'react';
import { Accelerometer } from 'expo-sensors';
import { createPetMachine, type Pose } from '../lib/pet-machine';

export type MotionDebug = {
  mag: number;      // 归一化后幅值(g)
  peakDev: number;  // 近 2s 内 |mag-1| 峰值
};

export function usePose(): { pose: Pose; debug: MotionDebug } {
  const [pose, setPose] = useState<Pose>('idle');
  const [debug, setDebug] = useState<MotionDebug>({ mag: 1, peakDev: 0 });
  const machineRef = useRef(createPetMachine());
  const poseRef = useRef<Pose>('idle');
  const peaksRef = useRef<{ t: number; dev: number }[]>([]);
  const lastDebugAt = useRef(0);

  useEffect(() => {
    Accelerometer.setUpdateInterval(100);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const t = Date.now();
      const next = machineRef.current.feed({ x, y, z, t });
      if (next !== poseRef.current) {
        poseRef.current = next;
        setPose(next);
      }
      // debug 数据(500ms 节流,不拖累渲染)
      const rawMag = Math.hypot(x, y, z);
      const mag = rawMag > 4 ? rawMag / 9.80665 : rawMag;
      const dev = Math.abs(mag - 1);
      peaksRef.current.push({ t, dev });
      peaksRef.current = peaksRef.current.filter((p) => t - p.t <= 2000);
      if (t - lastDebugAt.current >= 500) {
        lastDebugAt.current = t;
        setDebug({ mag, peakDev: Math.max(...peaksRef.current.map((p) => p.dev)) });
      }
    });
    return () => sub.remove();
  }, []);

  return { pose, debug };
}
