import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const INSTALL_DATE_KEY = '@splitnote/install_date';
const LAST_NOTIF_KEY = '@splitnote/last_notif_scheduled';

const DAY_MS = 24 * 60 * 60 * 1000;
const REMIND_AFTER_DAYS = 6;

/** Call once on first app launch to record install date and schedule reminder. */
export async function initAutoBackup(): Promise<void> {
  if (Platform.OS === 'web') return; // web builds don't expire; no 6-day reminder needed
  // Record install date if not already set
  const existing = await AsyncStorage.getItem(INSTALL_DATE_KEY);
  if (!existing) {
    await AsyncStorage.setItem(INSTALL_DATE_KEY, new Date().toISOString());
  }
  await scheduleBackupNotification();
}

/** Returns how many days since install (0 = same day). */
export async function daysSinceInstall(): Promise<number> {
  const raw = await AsyncStorage.getItem(INSTALL_DATE_KEY);
  if (!raw) return 0;
  return Math.floor((Date.now() - new Date(raw).getTime()) / DAY_MS);
}

/** Returns true if the app is on day 6+ and should prompt the user to export. */
export async function shouldPromptBackup(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const days = await daysSinceInstall();
  return days >= REMIND_AFTER_DAYS;
}

/** Schedule a local notification for day 6 (only once per install cycle). */
async function scheduleBackupNotification(): Promise<void> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  // Avoid re-scheduling if already done for this install
  const lastScheduled = await AsyncStorage.getItem(LAST_NOTIF_KEY);
  const installRaw = await AsyncStorage.getItem(INSTALL_DATE_KEY);
  if (!installRaw) return;

  const installDate = new Date(installRaw).toISOString().slice(0, 10);
  if (lastScheduled === installDate) return; // already scheduled for this install

  // Cancel any old backup reminders
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const notif of scheduled) {
    if (notif.content.data?.type === 'backup_reminder') {
      await Notifications.cancelScheduledNotificationAsync(notif.identifier);
    }
  }

  // Schedule for 6 days after install
  const triggerDate = new Date(new Date(installRaw).getTime() + REMIND_AFTER_DAYS * DAY_MS);
  // Only schedule if it's still in the future
  if (triggerDate.getTime() > Date.now()) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'SplitNote — Backup Reminder',
        body: "Day 6 already! Export your transactions now before they're gone.",
        sound: true,
        data: { type: 'backup_reminder' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
    });
  }

  await AsyncStorage.setItem(LAST_NOTIF_KEY, installDate);
}
