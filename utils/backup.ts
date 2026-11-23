import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { loadData, saveData, STORAGE_KEY, FRIENDS_KEY } from './storage';
import { Transaction } from '../types';

export interface BackupFile {
  version: 1;
  exportedAt: string;
  transactions: Transaction[];
  knownFriends: string[];
}

export async function exportBackup(): Promise<void> {
  const transactions = await loadData<Transaction[]>(STORAGE_KEY, []);
  const knownFriends = await loadData<string[]>(FRIENDS_KEY, []);

  const backup: BackupFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    transactions,
    knownFriends,
  };

  const json = JSON.stringify(backup, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `splitnote-backup-${date}.json`);

  if (file.exists) file.delete();
  file.create();
  file.write(json);

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error('Sharing is not available on this device');

  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Save SplitNote Backup',
    UTI: 'public.json',
  });
}

export type ImportResult =
  | { success: true; transactionCount: number }
  | { success: false; error: string };

export async function importBackup(): Promise<ImportResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let picked: any;
  try {
    picked = await File.pickFileAsync(undefined, 'application/json');
  } catch {
    return { success: false, error: 'cancelled' };
  }

  const file: File = Array.isArray(picked) ? picked[0] : picked;
  if (!file) return { success: false, error: 'cancelled' };

  const content = await file.text();

  let backup: BackupFile;
  try {
    backup = JSON.parse(content);
  } catch {
    return { success: false, error: 'File is not valid JSON' };
  }

  if (backup.version !== 1 || !Array.isArray(backup.transactions)) {
    return { success: false, error: 'File does not look like a SplitNote backup' };
  }

  await saveData(STORAGE_KEY, backup.transactions);
  if (Array.isArray(backup.knownFriends)) {
    await saveData(FRIENDS_KEY, backup.knownFriends);
  }

  return { success: true, transactionCount: backup.transactions.length };
}
