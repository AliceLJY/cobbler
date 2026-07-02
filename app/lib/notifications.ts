import * as Notifications from 'expo-notifications';

// Cobbler 的通知句池——她每天早上的一声轻咳
const LINES = [
  '水开了。今天的卡备好了。',
  '我翻了翻你的旧账,挑了一张。来看。',
  '今天这张卡有点意思。我先看过了。',
  '卡备好了。顺便,我昨晚想了想,那个 bug 还是你的问题。',
  '早。你的历史比你记得的有趣。',
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
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return; // 她不想被打扰就算了,不纠缠
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Cobbler', body: pickLine() },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 8,
        minute: 0,
      },
    });
  } catch {
    // 通知失败不影响宠物本体
  }
}
