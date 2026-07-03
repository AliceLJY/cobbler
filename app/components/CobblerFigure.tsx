import { StyleSheet, Text, View } from 'react-native';
import type { Pose } from '../lib/pet-machine';
import type { Mood } from '../lib/api';

// 简笔占位版:黑色圆身 robot,字符表情。生图资产就位后整体替换本组件内部。
const FACES: Record<string, { eyes: string; mouth: string }> = {
  idle: { eyes: '●   ●', mouth: '‥' },
  calm: { eyes: '●   ●', mouth: '‥' },
  happy: { eyes: '^   ^', mouth: '▿' },
  sleepy: { eyes: '–   –', mouth: '‥' },
  grumbly: { eyes: '●   ●', mouth: '︿' },
  sleeping: { eyes: '—   —', mouth: ' ' },
  bouncing: { eyes: '^   ^', mouth: '▿' },
  dizzy: { eyes: '×   ×', mouth: '~' },
  touched: { eyes: 'o   o', mouth: 'o' },   // 被摸到:惊讶
  party: { eyes: '＾   ＾', mouth: '▿' },   // 烟花中:大开心
};

export type FaceOverride = 'touched' | 'party' | null;

export function CobblerFigure({ pose, mood, override }: { pose: Pose; mood: Mood | null; override?: FaceOverride }) {
  // 优先级:触摸即时反应 > 传感器即时行为 > 巢基调心情
  const key = override ?? (pose === 'idle' ? (mood ?? 'idle') : pose);
  const face = FACES[key] ?? FACES.idle;
  return (
    <View style={styles.wrap}>
      <View style={styles.antenna} />
      <View style={styles.antennaTip} />
      <View style={styles.body}>
        <Text style={styles.eyes}>{face.eyes}</Text>
        <Text style={styles.mouth}>{face.mouth}</Text>
      </View>
      <View style={styles.legs}>
        <View style={styles.leg} />
        <View style={styles.leg} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  antenna: { width: 4, height: 18, backgroundColor: '#111' },
  antennaTip: {
    width: 12, height: 12, borderRadius: 6, backgroundColor: '#FF5DA2',
    marginTop: -4, marginBottom: -2,
  },
  body: {
    width: 140, height: 140, borderRadius: 70, backgroundColor: '#111',
    alignItems: 'center', justifyContent: 'center',
  },
  eyes: { color: '#fff', fontSize: 26, letterSpacing: 2, fontWeight: '700' },
  mouth: { color: '#fff', fontSize: 20, marginTop: 6 },
  legs: { flexDirection: 'row', gap: 28, marginTop: -2 },
  leg: { width: 5, height: 22, backgroundColor: '#111' },
});
