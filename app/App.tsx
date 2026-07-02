import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text } from 'react-native';
import { CobblerStage } from './components/CobblerStage';
import { CardDrawer } from './components/CardDrawer';
import { OfflineBadge } from './components/OfflineBadge';
import { usePose } from './hooks/useAccelerometer';
import { useNestData } from './hooks/useNestData';

const SHOW_DEBUG = true; // 调参期开;定参后关

export default function App() {
  const { pose, debug } = usePose();
  const { data } = useNestData();

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      {data.offline && <OfflineBadge />}
      <CobblerStage pose={pose} mood={data.state?.mood ?? null} mutter={data.state?.mutter ?? null} />
      {SHOW_DEBUG && (
        <Text style={styles.debug}>
          {pose} · mag {debug.mag.toFixed(2)} · peak2s {debug.peakDev.toFixed(2)} · raw {debug.rawMag.toFixed(1)} · n{debug.samples} · {debug.status}{debug.msq ? ' · m/s²锁' : ''}
        </Text>
      )}
      <CardDrawer state={data.state} todayCard={data.todayCard} cards={data.cards} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFDE59' },
  debug: { textAlign: 'center', fontSize: 12, color: '#111', opacity: 0.55, paddingBottom: 4 },
});
