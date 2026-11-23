import { useState, useEffect, useCallback } from 'react';
import { loadData, saveData, FRIENDS_KEY } from '../utils/storage';

export function useFriendSuggestions() {
  const [knownFriends, setKnownFriends] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const stored = await loadData<string[]>(FRIENDS_KEY, []);
      if (!cancelled) {
        setKnownFriends(stored);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateFriends = useCallback(
    async (newNames: string[]) => {
      // Merge new names with existing, deduplicate case-insensitively
      const lowerExisting = new Set(knownFriends.map(n => n.toLowerCase()));
      const toAdd = newNames.filter(n => !lowerExisting.has(n.toLowerCase().trim()));
      if (toAdd.length === 0) return;
      const merged = [...knownFriends, ...toAdd];
      setKnownFriends(merged);
      await saveData(FRIENDS_KEY, merged);
    },
    [knownFriends]
  );

  const getSuggestions = useCallback(
    (query: string): string[] => {
      if (!query.trim()) return knownFriends.slice(0, 8);
      const lower = query.toLowerCase();
      return knownFriends.filter(n => n.toLowerCase().includes(lower)).slice(0, 8);
    },
    [knownFriends]
  );

  return {
    knownFriends,
    updateFriends,
    getSuggestions,
  };
}
