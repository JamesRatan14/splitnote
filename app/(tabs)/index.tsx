import React, { useCallback } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  Text,
  ActivityIndicator,
} from 'react-native';
import { showAlert } from '../../utils/alert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTransactions } from '../../hooks/useTransactions';
import { TransactionCard } from '../../components/TransactionCard';
import { SummaryHeader } from '../../components/SummaryHeader';
import { EmptyState } from '../../components/EmptyState';
import { Colors } from '../../constants/Colors';
import { Spacing, Typography } from '../../constants/Layout';
import { Transaction } from '../../types';

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const colors = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { pending, transactions, isLoading, reload, markSynced, deleteTransaction } =
    useTransactions();

  useFocusEffect(useCallback(() => { reload(); return undefined; }, [reload]));

  const handleMarkSynced = useCallback(
    async (id: string) => {
      await markSynced(id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [markSynced]
  );

  const handleDelete = useCallback(
    (id: string) => {
      showAlert(
        'Delete Transaction',
        'Are you sure you want to delete this transaction? This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              await deleteTransaction(id);
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            },
          },
        ]
      );
    },
    [deleteTransaction]
  );

  const handleAddNew = () => {
    router.push('/transaction/new');
  };

  const renderItem = ({ item }: { item: Transaction }) => (
    <TransactionCard
      transaction={item}
      onMarkSynced={handleMarkSynced}
      onDelete={handleDelete}
      showSwipe
    />
  );

  const renderHeader = () => (
    <View>
      <SummaryHeader transactions={transactions} />
      <View style={styles.listHeader}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          PENDING ({pending.length})
        </Text>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Minimal header with safe area */}
      <View style={[styles.headerBar, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <Text style={[styles.appTitle, { color: colors.primary }]}>SplitNote</Text>
      </View>

      {pending.length === 0 ? (
        <View style={{ flex: 1 }}>
          <SummaryHeader transactions={transactions} />
          <EmptyState
            title="No pending transactions"
            subtitle="Tap + to log your first expense"
            iconName="receipt-outline"
          />
        </View>
      ) : (
        <FlatList
          data={pending}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 100 },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={[
          styles.fab,
          {
            backgroundColor: colors.primary,
            bottom: insets.bottom + Spacing.xl,
            shadowColor: colors.primary,
          },
        ]}
        onPress={handleAddNew}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Add expense"
      >
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </TouchableOpacity>
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
  },
  headerBar: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.md,
  },
  appTitle: {
    ...Typography.h2,
    marginTop: Spacing.md,
  },
  listHeader: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  list: {
    flexGrow: 1,
  },
  fab: {
    position: 'absolute',
    right: Spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
});
