import { useEffect, useRef, useState } from 'react';
import { Accelerometer } from 'expo-sensors';
import { createPetMachine, type Pose } from '../lib/pet-machine';

export type MotionDebug = {
  mag: number;      // 归一化后幅值(g,粘性单位锁与状态机一致)
  peakDev: number;  // 近 2s 内 |mag-1| 峰值
  rawMag: number;   // 原始未归一幅值(区分设备单位)
  msq: boolean;     // 粘性锁是否已判定 m/s²
  samples: number;  // 累计收到的传感器回调数(0 = 数据流没活)
  status: 'starting' | 'ok' | 'no-permission' | 'unavailable' | 'error';
};

const INIT: MotionDebug = { mag: 1, peakDev: 0, rawMag: 1, msq: false, samples: 0, status: 'starting' };

export function usePose(): { pose: Pose; debug: MotionDebug } {
  const [pose, setPose] = useState<Pose>('idle');
  const [debug, setDebug] = useState<MotionDebug>(INIT);
  const machineRef = useRef(createPetMachine());
  const poseRef = useRef<Pose>('idle');
  const peaksRef = useRef<{ t: number; dev: number }[]>([]);
  const lastDebugAt = useRef(0);
  const samplesRef = useRef(0);
  const statusRef = useRef<MotionDebug['status']>('starting');

  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    let mounted = true;

    (async () => {
      try {
        const available = await Accelerometer.isAvailableAsync();
        if (!available) {
          statusRef.current = 'unavailable';
          if (mounted) setDebug((d) => ({ ...d, status: 'unavailable' }));
          return;
        }
        // 新版 Expo Go / SDK 57 权限未授予时监听器会静默无回调,必须显式请求
        const perm = await Accelerometer.requestPermissionsAsync();
        if (!perm.granted) {
          statusRef.current = 'no-permission';
          if (mounted) setDebug((d) => ({ ...d, status: 'no-permission' }));
          return;
        }
        if (!mounted) return;
        statusRef.current = 'ok';
        Accelerometer.setUpdateInterval(100);
        sub = Accelerometer.addListener(({ x, y, z }) => {
          const t = Date.now();
          samplesRef.current += 1;
          const next = machineRef.current.feed({ x, y, z, t });
          if (next !== poseRef.current) {
            poseRef.current = next;
            setPose(next);
          }
          const { mag, dev, rawMag, msq } = machineRef.current.debug();
          peaksRef.current.push({ t, dev });
          peaksRef.current = peaksRef.current.filter((p) => t - p.t <= 2000);
          if (t - lastDebugAt.current >= 500) {
            lastDebugAt.current = t;
            setDebug({
              mag,
              peakDev: Math.max(...peaksRef.current.map((p) => p.dev)),
              rawMag,
              msq,
              samples: samplesRef.current,
              status: statusRef.current,
            });
          }
        });
      } catch {
        statusRef.current = 'error';
        if (mounted) setDebug((d) => ({ ...d, status: 'error' }));
      }
    })();

    return () => {
      mounted = false;
      sub?.remove();
    };
  }, []);

  return { pose, debug };
}
