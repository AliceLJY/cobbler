import { useEffect, useRef, useState } from 'react';
import { Accelerometer } from 'expo-sensors';
import { createPetMachine, type Pose } from '../lib/pet-machine';

export type MotionDebug = {
  mag: number;      // 归一化后幅值(g,粘性单位锁与状态机一致)
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
      // debug 数据来自状态机本体(同一套归一化),500ms 节流
      const { mag, dev } = machineRef.current.debug();
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
