import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';
import { CobblerStage } from './components/CobblerStage';
import { CardDrawer } from './components/CardDrawer';
import { OfflineBadge } from './components/OfflineBadge';
import { usePose } from './hooks/useAccelerometer';
import { useNestData } from './hooks/useNestData';

export default function App() {
  const pose = usePose();
  const { data } = useNestData();

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      {data.offline && <OfflineBadge />}
      <CobblerStage pose={pose} mood={data.state?.mood ?? null} mutter={data.state?.mutter ?? null} />
      <CardDrawer state={data.state} todayCard={data.todayCard} cards={data.cards} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFDE59' },
});
