import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getLastSeenDiaryDate, markDiarySeen, type NestCard, type NestState } from '../lib/api';

export function CardDrawer({ state, todayCard, cards }: {
  state: NestState | null;
  todayCard: NestCard | null;
  cards: NestCard[];
}) {
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState('');

  useEffect(() => {
    getLastSeenDiaryDate().then(setLastSeen);
  }, []);

  const newDiary = useMemo(
    () => (state?.diary ?? []).filter((d) => d.date > lastSeen),
    [state, lastSeen],
  );

  useEffect(() => {
    // 展开抽屉视为"读到她攒的话"
    if (open && newDiary.length) {
      const latest = newDiary[newDiary.length - 1].date;
      markDiarySeen(latest).catch(() => {});
    }
  }, [open, newDiary]);

  const history = cards.filter((c) => c.date !== todayCard?.date);

  return (
    <View style={[styles.drawer, open && styles.drawerOpen]}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.handleRow}>
        <Text style={styles.handleText} numberOfLines={1}>
          {open ? '▾ 收起' : `▴ ${todayCard ? todayCard.title : '她还在巢里翻箱倒柜……过会儿再来'}`}
        </Text>
        {!open && newDiary.length > 0 && <View style={styles.dot} />}
      </Pressable>
      {open && (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
          {newDiary.length > 0 && (
            <View style={styles.diaryBox}>
              <Text style={styles.sectionTitle}>她攒的话</Text>
              {newDiary.map((d) => (
                <Text key={d.date} style={styles.diaryText}>{d.date} · {d.text}</Text>
              ))}
            </View>
          )}
          {todayCard && (
            <View style={styles.todayCard}>
              <Text style={styles.cardTitle}>{todayCard.title}</Text>
              <Text style={styles.cardBody}>{todayCard.body}</Text>
              <Text style={styles.cardMeta}>{todayCard.relTime} · {todayCard.source === 'commit' ? 'git' : '学习打卡'}</Text>
            </View>
          )}
          {history.length > 0 && <Text style={styles.sectionTitle}>之前的卡</Text>}
          {history.map((c) => (
            <View key={c.date} style={styles.histCard}>
              <Text style={styles.histDate}>{c.date}</Text>
              <Text style={styles.histTitle}>{c.title}</Text>
              <Text style={styles.histBody}>{c.body}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    backgroundColor: '#FF5DA2', borderTopWidth: 3, borderColor: '#111',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24,
  },
  drawerOpen: { maxHeight: '62%' },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  handleText: { flex: 1, fontSize: 15, fontWeight: '700', color: '#111' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFDE59', borderWidth: 2, borderColor: '#111' },
  body: { marginTop: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#111', opacity: 0.7, marginBottom: 6, marginTop: 10 },
  diaryBox: {
    backgroundColor: '#fff', borderWidth: 3, borderColor: '#111', borderRadius: 12,
    padding: 12, marginBottom: 8,
  },
  diaryText: { fontSize: 14, color: '#111', lineHeight: 21, marginBottom: 4 },
  todayCard: {
    backgroundColor: '#FFDE59', borderWidth: 3, borderColor: '#111', borderRadius: 12, padding: 14,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#111', lineHeight: 24 },
  cardBody: { fontSize: 14, color: '#111', lineHeight: 21, marginTop: 8 },
  cardMeta: { fontSize: 12, color: '#111', opacity: 0.6, marginTop: 8 },
  histCard: {
    backgroundColor: '#fff', borderWidth: 2, borderColor: '#111', borderRadius: 10,
    padding: 12, marginBottom: 8,
  },
  histDate: { fontSize: 12, color: '#111', opacity: 0.6 },
  histTitle: { fontSize: 14, fontWeight: '700', color: '#111', marginTop: 2 },
  histBody: { fontSize: 13, color: '#111', lineHeight: 19, marginTop: 4 },
});
