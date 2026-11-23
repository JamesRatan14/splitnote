import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AI_SETTINGS_KEY, loadData, saveData } from '../utils/storage';
import type { AiSettings } from '../utils/ai/client';

const EMPTY: AiSettings = { url: '', passphrase: '' };

function sanitize(x: unknown): AiSettings {
  if (typeof x !== 'object' || x === null) return EMPTY;
  const o = x as Record<string, unknown>;
  return {
    url: typeof o.url === 'string' ? o.url : '',
    passphrase: typeof o.passphrase === 'string' ? o.passphrase : '',
  };
}

/** AI proxy settings, persisted on-device. Re-reads on screen focus so Settings edits apply everywhere. */
export function useAiSettings() {
  const [settings, setSettings] = useState<AiSettings>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const stored = await loadData<unknown>(AI_SETTINGS_KEY, EMPTY);
    setSettings(sanitize(stored));
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
      return undefined;
    }, [load])
  );

  const save = useCallback(async (next: AiSettings) => {
    const clean = { url: next.url.trim(), passphrase: next.passphrase };
    setSettings(clean);
    await saveData(AI_SETTINGS_KEY, clean);
  }, []);

  return { settings, loaded, save };
}
