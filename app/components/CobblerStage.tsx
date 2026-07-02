import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { CobblerFigure } from './CobblerFigure';
import type { Pose } from '../lib/pet-machine';
import type { Mood } from '../lib/api';

const DIZZY_LINE = '……你晃什么。';

export function CobblerStage({ pose, mood, mutter }: { pose: Pose; mood: Mood | null; mutter: string | null }) {
  const [showBubble, setShowBubble] = useState(true);
  const scale = useRef(new Animated.Value(1)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const rot = useRef(new Animated.Value(0)).current;

  // 呼吸(常驻,sleeping 时放慢)
  useEffect(() => {
    const dur = pose === 'sleeping' ? 1800 : 1000;
    const amp = pose === 'sleeping' ? 1.05 : 1.02;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: amp, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pose, scale]);

  // 颠(bouncing)
  useEffect(() => {
    if (pose !== 'bouncing') { ty.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ty, { toValue: -14, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(ty, { toValue: 0, duration: 150, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pose, ty]);

  // 晃(dizzy)
  useEffect(() => {
    if (pose !== 'dizzy') { rot.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(rot, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(rot, { toValue: -1, duration: 140, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pose, rot]);

  const rotate = rot.interpolate({ inputRange: [-1, 1], outputRange: ['-12deg', '12deg'] });
  const bubbleText = pose === 'dizzy' ? DIZZY_LINE : mutter;

  return (
    <View style={styles.stage}>
      {showBubble && !!bubbleText && pose !== 'sleeping' && (
        <View style={styles.bubble}>
          <Text style={styles.bubbleText}>{bubbleText}</Text>
        </View>
      )}
      {pose === 'sleeping' && <Text style={styles.zzz}>Z z z</Text>}
      <Pressable onPress={() => setShowBubble((v) => !v)}>
        <Animated.View style={{ transform: [{ scale }, { translateY: ty }, { rotate }] }}>
          <CobblerFigure pose={pose} mood={mood} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  bubble: {
    maxWidth: '82%', backgroundColor: '#fff', borderWidth: 3, borderColor: '#111',
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10,
  },
  bubbleText: { fontSize: 15, color: '#111', lineHeight: 22 },
  zzz: { fontSize: 22, fontWeight: '700', color: '#111', opacity: 0.6 },
});
