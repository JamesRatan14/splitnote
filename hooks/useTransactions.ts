import { useState, useEffect, useCallback } from 'react';
import { Transaction, NewTransactionInput } from '../types';
import { loadData, saveData, STORAGE_KEY } from '../utils/storage';
import { generateId } from '../utils/uuid';

export function useTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    const stored = await loadData<Transaction[]>(STORAGE_KEY, []);
    setTransactions(Array.isArray(stored) ? stored : []);
    setIsLoading(false);
  }, []);

  // Load from AsyncStorage on mount
  useEffect(() => {
    load();
  }, [load]);

  // Apply a change to the LATEST stored list (not this screen's possibly-stale copy),
  // then update state and save. Prevents one screen overwriting another's writes.
  const mutate = useCallback(async (fn: (current: Transaction[]) => Transaction[]) => {
    const current = await loadData<Transaction[]>(STORAGE_KEY, []);
    const updated = fn(Array.isArray(current) ? current : []);
    setTransactions(updated);
    await saveData(STORAGE_KEY, updated);
  }, []);

  const addTransaction = useCallback(
    async (data: NewTransactionInput) => {
      const newTx: Transaction = {
        ...data,
        id: generateId(),
        createdAt: new Date().toISOString(),
        syncStatus: 'pending',
      };
      await mutate(current => [newTx, ...current]);
    },
    [mutate]
  );

  const markSynced = useCallback(
    async (id: string) => {
      await mutate(current =>
        current.map(t => (t.id === id ? { ...t, syncStatus: 'synced' as const } : t))
      );
    },
    [mutate]
  );

  const markPending = useCallback(
    async (id: string) => {
      await mutate(current =>
        current.map(t => (t.id === id ? { ...t, syncStatus: 'pending' as const } : t))
      );
    },
    [mutate]
  );

  const deleteTransaction = useCallback(
    async (id: string) => {
      await mutate(current => current.filter(t => t.id !== id));
    },
    [mutate]
  );

  const getById = useCallback(
    (id: string): Transaction | undefined => {
      return transactions.find(t => t.id === id);
    },
    [transactions]
  );

  const pending = transactions
    .filter(t => t.syncStatus === 'pending')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const synced = transactions
    .filter(t => t.syncStatus === 'synced')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    transactions,
    pending,
    synced,
    isLoading,
    reload: load,
    addTransaction,
    markSynced,
    markPending,
    deleteTransaction,
    getById,
  };
}
