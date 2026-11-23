import { loadData, saveData, STORAGE_KEY, FRIENDS_KEY } from './storage';
import type { Transaction } from '../types';
import type { BackupFile, ImportResult } from './backup';

/** Web implementation: download a JSON file / pick one with a hidden <input>. */
export async function exportBackup(): Promise<void> {
  const transactions = await loadData<Transaction[]>(STORAGE_KEY, []);
  const knownFriends = await loadData<string[]>(FRIENDS_KEY, []);
  const backup: BackupFile = { version: 1, exportedAt: new Date().toISOString(), transactions, knownFriends };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `splitnote-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importBackup(): Promise<ImportResult> {
  const file = await new Promise<File | null>(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
    input.oncancel = () => resolve(null);
    input.click();
  });
  if (!file) return { success: false, error: 'cancelled' };

  let backup: BackupFile;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    return { success: false, error: 'File is not valid JSON' };
  }
  if (backup.version !== 1 || !Array.isArray(backup.transactions)) {
    return { success: false, error: 'File does not look like a SplitNote backup' };
  }
  await saveData(STORAGE_KEY, backup.transactions);
  if (Array.isArray(backup.knownFriends)) await saveData(FRIENDS_KEY, backup.knownFriends);
  return { success: true, transactionCount: backup.transactions.length };
}

export type { BackupFile, ImportResult };
