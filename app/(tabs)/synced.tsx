import React, { useCallback } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Text,
  useColorScheme,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useTransactions } from '../../hooks/useTransactions';
import { TransactionCard } from '../../components/TransactionCard';
import { EmptyState } from '../../components/EmptyState';
import { Colors } from '../../constants/Colors';
import { Spacing, Typography } from '../../constants/Layout';
import { Transaction } from '../../types';

export default function SyncedScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const colors = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { synced, isLoading, reload } = useTransactions();

  useFocusEffect(useCallback(() => { reload(); return undefined; }, [reload]));

  const renderItem = ({ item }: { item: Transaction }) => (
    <TransactionCard
      transaction={item}
      showSwipe={false}
    />
  );

  const renderHeader = () => (
    <View style={styles.listHeader}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
        SYNCED ({synced.length})
      </Text>
      <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
        These have been recorded in Splitwise
      </Text>
    </View>
  );

  if (isLoading) {
    return (
      <View
        style={[
          styles.loadingContainer,
          { paddingTop: insets.top, backgroundColor: colors.background },
        ]}
      >
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Minimal header with safe area */}
      <View
        style={[
          styles.headerBar,
          { paddingTop: insets.top, backgroundColor: colors.background },
        ]}
      >
        <Text style={[styles.appTitle, { color: colors.text }]}>Archive</Text>
      </View>

      {synced.length === 0 ? (
        <EmptyState
          title="No synced transactions"
          subtitle="Transactions you mark as synced will appear here"
          iconName="checkmark-circle-outline"
        />
      ) : (
        <FlatList
          data={synced}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}
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
    marginBottom: Spacing.xs,
  },
  sectionSubtitle: {
    ...Typography.caption,
  },
  list: {
    flexGrow: 1,
  },
});
