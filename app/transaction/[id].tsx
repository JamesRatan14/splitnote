import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  ActivityIndicator,
} from 'react-native';
import { showAlert } from '../../utils/alert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTransactions } from '../../hooks/useTransactions';
import { SplitBreakdown } from '../../components/SplitBreakdown';
import { Colors } from '../../constants/Colors';
import { Spacing, Radius, Typography } from '../../constants/Layout';
import { formatDate, formatCurrency, formatDateTime } from '../../utils/formatters';

export default function TransactionDetailScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const colors = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getById, markSynced, markPending, deleteTransaction, isLoading } =
    useTransactions();

  const transaction = id ? getById(id) : undefined;

  const handleMarkSynced = useCallback(async () => {
    if (!transaction) return;
    await markSynced(transaction.id);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }, [transaction, markSynced]);

  const handleMarkPending = useCallback(async () => {
    if (!transaction) return;
    await markPending(transaction.id);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }, [transaction, markPending]);

  const handleDelete = useCallback(() => {
    if (!transaction) return;
    showAlert(
      'Delete Transaction',
      `Are you sure you want to delete "${transaction.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteTransaction(transaction.id);
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.back();
          },
        },
      ]
    );
  }, [transaction, deleteTransaction]);

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!transaction) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.textSecondary} />
        <Text style={[styles.notFoundText, { color: colors.textSecondary }]}>
          Transaction not found
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
          <Text style={[styles.backLinkText, { color: colors.primary }]}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isPending = transaction.syncStatus === 'pending';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 140 },
        ]}
      >
        {/* Hero section */}
        <View
          style={[
            styles.heroSection,
            {
              backgroundColor: colors.surface,
              shadowColor: colors.primary,
            },
          ]}
        >
          <Text style={[styles.heroTitle, { color: colors.text }]} numberOfLines={3}>
            {transaction.title}
          </Text>
          <Text style={[styles.heroAmount, { color: colors.primary }]}>
            {formatCurrency(transaction.amount + (transaction.tax ?? 0))}
          </Text>

          <View style={styles.heroBadgeRow}>
            {/* Payment mode badge */}
            <View style={[styles.badge, { backgroundColor: colors.surfaceHigh }]}>
              <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                {transaction.mode}
              </Text>
            </View>

            {/* Date */}
            <View style={[styles.badge, { backgroundColor: colors.surfaceHigh }]}>
              <Ionicons name="calendar-outline" size={12} color={colors.textSecondary} />
              <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                {' '}{formatDate(transaction.date)}
              </Text>
            </View>

            {/* Sync status */}
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: isPending ? colors.pendingLight : colors.primaryLight,
                },
              ]}
            >
              <Ionicons
                name={isPending ? 'time-outline' : 'checkmark-circle'}
                size={12}
                color={isPending ? colors.pending : colors.success}
              />
              <Text
                style={[
                  styles.badgeText,
                  { color: isPending ? colors.pending : colors.success },
                ]}
              >
                {' '}{isPending ? 'Pending' : 'Synced'}
              </Text>
            </View>
          </View>
        </View>

        {/* Split breakdown */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Split Breakdown</Text>
          <SplitBreakdown transaction={transaction} />
        </View>

        {/* Note */}
        {transaction.note ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Note</Text>
            <View style={[styles.noteBox, { backgroundColor: colors.surface }]}>
              <Text style={[styles.noteText, { color: colors.textSecondary }]}>
                {transaction.note}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Metadata */}
        <View style={styles.section}>
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>
            Created {formatDateTime(transaction.createdAt)}
          </Text>
        </View>
      </ScrollView>

      {/* Action buttons */}
      <View
        style={[
          styles.actionBar,
          {
            backgroundColor: colors.surface,
            paddingBottom: insets.bottom + Spacing.lg,
            shadowColor: '#000',
          },
        ]}
      >
        {isPending ? (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            onPress={handleMarkSynced}
            activeOpacity={0.85}
          >
            <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>Mark as Synced</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.secondaryButton, { backgroundColor: colors.surfaceHigh }]}
            onPress={handleMarkPending}
            activeOpacity={0.85}
          >
            <Ionicons name="refresh" size={18} color={colors.primary} />
            <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>
              Restore to Pending
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.deleteButton, { backgroundColor: colors.dangerLight }]}
          onPress={handleDelete}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Delete expense"
        >
          <Ionicons name="trash" size={20} color={colors.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  notFoundText: {
    ...Typography.body,
  },
  backLink: {
    marginTop: Spacing.sm,
  },
  backLinkText: {
    ...Typography.body,
    fontWeight: '600',
  },
  scrollContent: {
    flexGrow: 1,
  },
  heroSection: {
    padding: Spacing.xl,
    marginBottom: Spacing.sm,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 6,
  },
  heroTitle: {
    ...Typography.h2,
    marginBottom: Spacing.sm,
  },
  heroAmount: {
    ...Typography.amount,
    marginBottom: Spacing.lg,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
  },
  badgeText: {
    ...Typography.caption,
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  sectionTitle: {
    ...Typography.h3,
    marginBottom: Spacing.md,
  },
  noteBox: {
    borderRadius: Radius.md,
    padding: Spacing.lg,
  },
  noteText: {
    ...Typography.body,
    lineHeight: 22,
  },
  metaText: {
    ...Typography.caption,
    textAlign: 'center',
  },
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    gap: Spacing.md,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    height: 54,
    gap: Spacing.sm,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    ...Typography.h3,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    height: 54,
    gap: Spacing.sm,
  },
  secondaryButtonText: {
    ...Typography.h3,
  },
  deleteButton: {
    width: 54,
    height: 54,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
