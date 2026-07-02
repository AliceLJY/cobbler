import { StyleSheet, Text, View } from 'react-native';

export function OfflineBadge() {
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>离巢</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute', top: 56, left: 16, zIndex: 10,
    backgroundColor: '#fff', borderWidth: 2, borderColor: '#111',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  text: { fontSize: 12, fontWeight: '700', color: '#111' },
});
