import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const DAILY_CHANNEL_ID = 'cobbler-daily';

// Cobbler 的通知句池——她每天早上的一声轻咳
// 注意:不承诺"卡已备好"(巢可能睡过头,卡由 API 惰性补生成,点开即触发)
const LINES = [
  '水开了。来坐会儿。',
  '早。我去翻你的旧账了。',
  '我在。你的历史比你记得的有趣。',
  '早。顺便,我昨晚想了想,那个 bug 还是你的问题。',
  '水快开了。来的路上想想今天写什么。',
];

export function pickLine(rng: () => number = Math.random): string {
  return LINES[Math.floor(rng() * LINES.length)];
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// 每次 app 打开时调用:请求权限并重排每日 8:00 的通知(巢 7:30 生成完半小时后)
export async function ensureDailyNudge(): Promise<void> {
  try {
    // Android 13 只有在 app 先创建通知频道后才会弹出通知权限请求。
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(DAILY_CHANNEL_ID, {
        name: 'Cobbler daily nudge',
        description: 'Cobbler 每天早上的一声轻咳',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return; // 她不想被打扰就算了,不纠缠
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Cobbler', body: pickLine() },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 8,
        minute: 0,
        channelId: Platform.OS === 'android' ? DAILY_CHANNEL_ID : undefined,
      },
    });
  } catch {
    // 通知失败不影响宠物本体
  }
}
