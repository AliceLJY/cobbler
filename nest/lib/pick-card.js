import { diffDays } from './dates.js';

export function pickCard(items, todayISO, rng = Math.random) {
  // "同日" = DD 相同(每月的今天),排除今天本身,最旧优先
  const dd = todayISO.slice(8);
  const sameDay = items
    .filter((i) => i.date.slice(8) === dd && i.date !== todayISO)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sameDay.length) return sameDay[0];
  const old = items.filter((i) => diffDays(i.date, todayISO) > 30);
  if (!old.length) return null;
  return old[Math.floor(rng() * old.length)];
}
