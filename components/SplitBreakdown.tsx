import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { Transaction } from '../types';
import { getPersonBreakdown, getTotalToCollect } from '../utils/calculations';
import { formatCurrency } from '../utils/formatters';
import { Colors } from '../constants/Colors';
import { Spacing, Radius, Typography } from '../constants/Layout';

export function SplitBreakdown({ transaction }: { transaction: Transaction }) {
  const colorScheme = useColorScheme() ?? 'dark';
  const colors = Colors[colorScheme];

  const includeMe = transaction.includeMe ?? false;
  const hasTax = (transaction.tax ?? 0) > 0;
  const totalToCollect = getTotalToCollect(transaction);
  const breakdown = getPersonBreakdown(transaction);

  // Compute my share
  const tax = transaction.tax ?? 0;
  const subtotal = transaction.amount; // amount is items-only; total = amount + tax
  const friendsItemTotal = Object.values(breakdown).reduce((s, v) => s + v.item, 0);
  const friendsTaxTotal = Object.values(breakdown).reduce((s, v) => s + v.tax, 0);
  const myItemShare = Math.round((subtotal - friendsItemTotal) * 100) / 100;
  const myTaxShare = Math.round((tax - friendsTaxTotal) * 100) / 100;

  return (
    <View>
      <View style={[styles.table, { borderColor: colors.border }]}>
        {/* Header row — only when tax is present */}
        {hasTax && (
          <View style={[styles.headerRow, { backgroundColor: colors.surfaceHigh, borderBottomColor: colors.border }]}>
            <Text style={[styles.headerCell, { color: colors.textSecondary, flex: 1 }]}>Person</Text>
            <Text style={[styles.headerCell, { color: colors.textSecondary }]}>Items</Text>
            <Text style={[styles.headerCell, { color: colors.textSecondary }]}>Tax</Text>
            <Text style={[styles.headerCell, { color: colors.textSecondary }]}>Total</Text>
          </View>
        )}

        {/* You row */}
        {includeMe && (
          <View style={[styles.row, {
            backgroundColor: colors.primaryLight,
            borderBottomColor: colors.border,
            borderBottomWidth: transaction.participants.length > 0 ? StyleSheet.hairlineWidth : 0,
          }]}>
            <View style={styles.nameCell}>
              <Text style={[styles.rowName, { color: colors.primaryMid, fontWeight: '600' }]}>You</Text>
              <Text style={[styles.subLabel, { color: colors.primaryMid }]}>Your share</Text>
            </View>
            {hasTax ? (
              <>
                <Text style={[styles.amountCell, { color: colors.primaryMid }]}>{formatCurrency(myItemShare)}</Text>
                <Text style={[styles.amountCell, { color: colors.primaryMid }]}>{formatCurrency(myTaxShare)}</Text>
                <Text style={[styles.amountCell, { color: colors.primaryMid, fontWeight: '700' }]}>
                  {formatCurrency(Math.round((myItemShare + myTaxShare) * 100) / 100)}
                </Text>
              </>
            ) : (
              <Text style={[styles.rowAmount, { color: colors.primaryMid, fontWeight: '700' }]}>
                {formatCurrency(myItemShare)}
              </Text>
            )}
          </View>
        )}

        {/* Friend rows */}
        {transaction.participants.map((name, index) => {
          const b = breakdown[name] ?? { item: 0, tax: 0, total: 0 };
          return (
            <View
              key={name + index}
              style={[styles.row, {
                backgroundColor: colors.surface,
                borderBottomColor: colors.border,
                borderBottomWidth: index < transaction.participants.length - 1 ? StyleSheet.hairlineWidth : 0,
              }]}
            >
              <View style={styles.nameCell}>
                <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
              </View>
              {hasTax ? (
                <>
                  <Text style={[styles.amountCell, { color: colors.textSecondary }]}>{formatCurrency(b.item)}</Text>
                  <Text style={[styles.amountCell, { color: colors.pending }]}>{formatCurrency(b.tax)}</Text>
                  <Text style={[styles.amountCell, { color: colors.text, fontWeight: '700' }]}>{formatCurrency(b.total)}</Text>
                </>
              ) : (
                <Text style={[styles.rowAmount, { color: colors.text, fontWeight: '600' }]}>{formatCurrency(b.total)}</Text>
              )}
            </View>
          );
        })}
      </View>

      {/* Tax summary line */}
      {hasTax && (
        <View style={[styles.taxSummary, { backgroundColor: colors.pendingLight, borderRadius: Radius.md }]}>
          <Text style={[styles.taxSummaryText, { color: colors.pending }]}>
            Tax included: {formatCurrency(tax)} · {transaction.taxSplitType === 'proportional' ? 'Split by item ratio' : transaction.taxSplitType === 'custom' ? 'Custom per person' : 'Split equally'}
          </Text>
        </View>
      )}

      <Text style={[styles.splitInfo, { color: colors.textSecondary }]}>
        {formatCurrency(transaction.amount + tax)} · {transaction.splitType === 'custom' ? 'Custom split' : includeMe ? 'Equal (you included)' : 'You collect all'}
      </Text>

      {totalToCollect > 0 && (
        <View style={[styles.callout, { backgroundColor: colors.primaryLight }]}>
          <Text style={[styles.calloutLabel, { color: colors.primaryMid }]}>Total to collect</Text>
          <Text style={[styles.calloutAmount, { color: colors.primary }]}>{formatCurrency(totalToCollect)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  table: { borderRadius: Radius.md, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, marginBottom: Spacing.md },
  headerRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCell: { ...Typography.caption, fontWeight: '600', minWidth: 64, textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  nameCell: { flex: 1, marginRight: Spacing.sm },
  rowName: { ...Typography.body },
  subLabel: { ...Typography.caption, marginTop: 2 },
  rowAmount: { ...Typography.body, flexShrink: 0 },
  amountCell: { ...Typography.caption, minWidth: 64, textAlign: 'right' },
  taxSummary: { padding: Spacing.md, marginBottom: Spacing.md, alignItems: 'center' },
  taxSummaryText: { ...Typography.caption, fontWeight: '600' },
  splitInfo: { ...Typography.caption, textAlign: 'center', marginBottom: Spacing.lg },
  callout: { borderRadius: Radius.lg, padding: Spacing.xl, alignItems: 'center' },
  calloutLabel: { ...Typography.caption, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm },
  calloutAmount: { ...Typography.amount },
});
