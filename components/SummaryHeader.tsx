import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { Transaction } from '../types';
import { getTotalPending, getOwedByFriend } from '../utils/calculations';
import { formatCurrency } from '../utils/formatters';
import { Colors } from '../constants/Colors';
import { Spacing, Radius, Typography } from '../constants/Layout';

interface SummaryHeaderProps {
  transactions: Transaction[];
}

export function SummaryHeader({ transactions }: SummaryHeaderProps) {
  const colorScheme = useColorScheme() ?? 'dark';
  const colors = Colors[colorScheme];

  const totalPending = getTotalPending(transactions);
  const owedByFriend = getOwedByFriend(transactions);
  const friendEntries = Object.entries(owedByFriend);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.label, { color: colors.textSecondary }]}>TOTAL TO COLLECT</Text>
      <Text style={[styles.total, { color: colors.primary }]}>{formatCurrency(totalPending)}</Text>

      {friendEntries.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContainer}
        >
          {friendEntries.map(([name, amount]) => (
            <View
              key={name}
              style={[
                styles.chip,
                {
                  backgroundColor: colors.primaryLight,
                  borderColor: 'rgba(0,212,184,0.5)',
                },
              ]}
            >
              <Text style={[styles.chipText, { color: colors.primary }]} numberOfLines={1}>
                {name} {formatCurrency(amount)}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: Spacing.lg,
    borderRadius: Radius.xl,
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
    borderWidth: 1,
  },
  label: {
    ...Typography.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  total: {
    ...Typography.amount,
    marginBottom: Spacing.md,
  },
  chipsContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.full,
    maxWidth: 180,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
