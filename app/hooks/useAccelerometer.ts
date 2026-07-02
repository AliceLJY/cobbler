import { useEffect, useRef, useState } from 'react';
import { Accelerometer } from 'expo-sensors';
import { createPetMachine, type Pose } from '../lib/pet-machine';

export function usePose(): Pose {
  const [pose, setPose] = useState<Pose>('idle');
  const machineRef = useRef(createPetMachine());
  const poseRef = useRef<Pose>('idle');

  useEffect(() => {
    Accelerometer.setUpdateInterval(100);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const next = machineRef.current.feed({ x, y, z, t: Date.now() });
      if (next !== poseRef.current) {
        poseRef.current = next;
        setPose(next);
      }
    });
    return () => sub.remove();
  }, []);

  return pose;
}
