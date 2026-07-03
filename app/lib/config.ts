import AsyncStorage from '@react-native-async-storage/async-storage';

// 构建时经 EXPO_PUBLIC_NEST_URL 注入(EAS 环境变量),不把私网地址写进公开代码
export const DEFAULT_BASE_URL =
  process.env.EXPO_PUBLIC_NEST_URL ?? 'https://your-nest.your-tailnet.ts.net:10000';
const KEY = 'cobbler.baseUrl';

export async function getBaseUrl(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(KEY)) || DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export async function setBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(KEY, url.trim().replace(/\/$/, ''));
}
