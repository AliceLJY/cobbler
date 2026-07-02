import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEFAULT_BASE_URL = 'https://mac-mini.tail791fb9.ts.net:10000';
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
