import { diffDays } from './dates.js';

export function judgeMood(signals, todayISO) {
  const { lastSignalISO, commits7d, learningsThisWeek, lastHeartbeatISO, activityYesterday } = signals;
  if (!lastSignalISO || diffDays(lastSignalISO, todayISO) >= 4) return 'grumbly';
  const active = commits7d >= 5 || learningsThisWeek;
  const seen = lastHeartbeatISO && diffDays(lastHeartbeatISO, todayISO) <= 3;
  if (active && seen) return 'happy';
  if (!activityYesterday) return 'sleepy';
  return 'calm';
}
