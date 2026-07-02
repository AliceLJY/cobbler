import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBaseUrl } from './config';

export type Mood = 'calm' | 'happy' | 'sleepy' | 'grumbly';

export type NestState = {
  name: string;
  mood: Mood;
  mutter: string;
  diary: { date: string; text: string }[];
  stats: { commits7d: number; learningsUpdated: boolean; lastSeen: string | null };
  generatedAt: string;
};

export type NestCard = {
  date: string;
  title: string;
  body: string;
  source: 'learning' | 'commit';
  sourceDetail: string;
  relTime: string;
};

export type NestData = {
  state: NestState | null;
  todayCard: NestCard | null;
  cards: NestCard[];
  offline: boolean;
};

const CACHE_KEY = 'cobbler.cache';
const TIMEOUT_MS = 5000;

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadNest(): Promise<NestData> {
  try {
    // 心跳先行(她的"陪伴"信号);失败不阻塞加载
    fetchJSON('/api/heartbeat', { method: 'POST' }).catch(() => {});
    const state = await fetchJSON<NestState>('/api/state');
    const todayCard = await fetchJSON<NestCard>('/api/card/today').catch(() => null);
    const cards = await fetchJSON<NestCard[]>('/api/cards?limit=30').catch(() => []);
    const data: NestData = { state, todayCard, cards, offline: false };
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data)).catch(() => {});
    return data;
  } catch {
    // 离巢:回缓存
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) return { ...(JSON.parse(raw) as NestData), offline: true };
    } catch {}
    return { state: null, todayCard: null, cards: [], offline: true };
  }
}

const SEEN_DIARY_KEY = 'cobbler.lastSeenDiaryDate';

export async function getLastSeenDiaryDate(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(SEEN_DIARY_KEY)) || '';
  } catch {
    return '';
  }
}

export async function markDiarySeen(date: string): Promise<void> {
  await AsyncStorage.setItem(SEEN_DIARY_KEY, date);
}
