import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { showAlert } from '../../utils/alert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/Colors';
import { Spacing, Radius, Typography } from '../../constants/Layout';
import { exportBackup, importBackup } from '../../utils/backup';
import { useTransactions } from '../../hooks/useTransactions';
import { shouldPromptBackup, daysSinceInstall } from '../../utils/autoBackup';

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const colors = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { reload } = useTransactions();

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [daysInstalled, setDaysInstalled] = useState(0);

  useFocusEffect(useCallback(() => {
    daysSinceInstall().then(setDaysInstalled);
    shouldPromptBackup().then(should => {
      if (should) {
        showAlert(
          'Time to Back Up!',
          "It's been 6 days since you installed SplitNote. Export your data now to keep it safe.",
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Export Now', onPress: handleExport },
          ]
        );
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportBackup();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      showAlert('Export Failed', msg);
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    showAlert(
      'Import Backup',
      'This will replace all your current data with the backup file. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          style: 'destructive',
          onPress: async () => {
            setImporting(true);
            try {
              const result = await importBackup();
              if (result.success === false) {
                if (result.error !== 'cancelled') {
                  showAlert('Import Failed', result.error);
                }
                return;
              }
              await reload();
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              showAlert('Import Successful', `Restored ${result.transactionCount} transaction${result.transactionCount !== 1 ? 's' : ''}.`);
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : 'Unknown error';
              showAlert('Import Failed', msg);
            } finally {
              setImporting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.background, paddingTop: insets.top + Spacing.md }]}>
        <Text style={[styles.headerTitle, { color: colors.primary }]}>Settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Day counter */}
        {daysInstalled > 0 && (
          <View style={[styles.dayBanner, {
            backgroundColor: daysInstalled >= 6 ? colors.dangerLight : colors.primaryLight,
          }]}>
            <Ionicons
              name={daysInstalled >= 6 ? 'warning-outline' : 'time-outline'}
              size={16}
              color={daysInstalled >= 6 ? colors.danger : colors.primary}
            />
            <Text style={[styles.dayBannerText, {
              color: daysInstalled >= 6 ? colors.danger : colors.primary,
            }]}>
              {daysInstalled >= 6
                ? `Day ${daysInstalled} — Export your data now!`
                : `Day ${daysInstalled} of 6 — ${6 - daysInstalled} day${6 - daysInstalled !== 1 ? 's' : ''} until backup reminder`}
            </Text>
          </View>
        )}

        {/* Backup section */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>DATA BACKUP</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>

          {/* Export */}
          <TouchableOpacity
            style={styles.row}
            onPress={handleExport}
            disabled={exporting || importing}
            activeOpacity={0.7}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
              {exporting
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Ionicons name="cloud-upload-outline" size={20} color={colors.primary} />}
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>Export Backup</Text>
              <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
                Save all transactions to a JSON file
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Import */}
          <TouchableOpacity
            style={styles.row}
            onPress={handleImport}
            disabled={exporting || importing}
            activeOpacity={0.7}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.pendingLight }]}>
              {importing
                ? <ActivityIndicator size="small" color={colors.pending} />
                : <Ionicons name="cloud-download-outline" size={20} color={colors.pending} />}
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>Import Backup</Text>
              <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
                Restore transactions from a JSON file
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Export your data before reinstalling the app to avoid losing transactions. Save the file to iCloud Drive or Files for safekeeping.
        </Text>

        {/* App info */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>ABOUT</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: colors.surfaceHigh }]}>
              <Ionicons name="receipt-outline" size={20} color={colors.textSecondary} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>SplitNote</Text>
              <Text style={[styles.rowSub, { color: colors.textSecondary }]}>Version 1.0.0</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  headerTitle: { ...Typography.h1 },
  content: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg },
  sectionLabel: {
    ...Typography.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
    marginTop: Spacing.lg,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: { ...Typography.body, fontWeight: '600' },
  rowSub: { ...Typography.caption, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.lg + 40 + Spacing.md },
  hint: {
    ...Typography.caption,
    marginTop: Spacing.md,
    lineHeight: 18,
  },
  dayBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  dayBannerText: {
    ...Typography.body,
    fontWeight: '600',
    flex: 1,
  },
});
