import AsyncStorage from '@react-native-async-storage/async-storage';

export const STORAGE_KEY = '@splitnote/transactions_v1';
export const FRIENDS_KEY = '@splitnote/known_friends_v1';

export async function loadData<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function saveData<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Storage save failed', e);
  }
}

/** AI proxy URL + passphrase (on-device only; never in the bundle). */
export const AI_SETTINGS_KEY = '@splitnote/ai_settings_v1';
