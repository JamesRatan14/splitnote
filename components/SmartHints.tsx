import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import { Spacing, Radius, Typography } from '../constants/Layout';
import type { PaymentMode } from '../types';
import type { AnomalyFlag, Category } from '../utils/ml';

// Small, unobtrusive suggestion UI for the Add screen. Every hint is either informational
// or applied only when the user taps it — model guesses are never saved silently.

function useColors() {
  return Colors[useColorScheme() ?? 'dark'];
}

export function CategoryHint({ category }: { category: Category | null }) {
  const colors = useColors();
  if (!category) return null;
  return (
    <View style={styles.inlineRow} accessibilityLabel={`Looks like ${category}`}>
      <Ionicons name="pricetag-outline" size={12} color={colors.textSecondary} />
      <Text style={[styles.inlineText, { color: colors.textSecondary }]}>Looks like {category}</Text>
    </View>
  );
}

export function ModeHint({ mode, onApply }: { mode: PaymentMode | null; onApply: (mode: PaymentMode) => void }) {
  const colors = useColors();
  if (!mode) return null;
  return (
    <TouchableOpacity
      style={[styles.modeHint, { backgroundColor: colors.primaryLight }]}
      onPress={() => onApply(mode)}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Use ${mode}`}
    >
      <Ionicons name="sparkles-outline" size={14} color={colors.primary} />
      <Text style={[styles.modeHintText, { color: colors.text }]}>
        You usually use <Text style={{ fontWeight: '700' }}>{mode}</Text> for this
      </Text>
      <Text style={[styles.modeHintAction, { color: colors.primary }]}>Use</Text>
    </TouchableOpacity>
  );
}

export function FriendSuggestions({ names, onAdd }: { names: string[]; onAdd: (name: string) => void }) {
  const colors = useColors();
  if (names.length === 0) return null;
  return (
    <View style={styles.friendRow}>
      <Text style={[styles.inlineText, { color: colors.textSecondary }]}>Suggested:</Text>
      {names.map(name => (
        <TouchableOpacity
          key={name}
          onPress={() => onAdd(name)}
          style={[styles.friendChip, { borderColor: colors.primary, backgroundColor: colors.primaryLight }]}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Add ${name}`}
        >
          <Ionicons name="add" size={14} color={colors.primary} />
          <Text style={[styles.friendChipText, { color: colors.primary }]} numberOfLines={1}>
            {name}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function AnomalyWarnings({ warnings }: { warnings: AnomalyFlag[] }) {
  const colors = useColors();
  if (warnings.length === 0) return null;
  return (
    <View style={[styles.warning, { backgroundColor: colors.pendingLight }]} accessibilityRole="alert">
      {warnings.map(w => (
        <View key={w.kind} style={styles.warningRow}>
          <Ionicons
            name={w.kind === 'duplicate' ? 'copy-outline' : 'alert-circle-outline'}
            size={14}
            color={colors.pending}
          />
          <Text style={[styles.warningText, { color: colors.pending }]}>{w.message}</Text>
        </View>
      ))}
      <Text style={[styles.warningFoot, { color: colors.pending }]}>Double-check before saving. You can still save.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.xs },
  inlineText: { ...Typography.caption },
  modeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  modeHintText: { ...Typography.caption, flex: 1 },
  modeHintAction: { ...Typography.caption, fontWeight: '700' },
  friendRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  friendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    maxWidth: 160,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  friendChipText: { ...Typography.caption, fontWeight: '600' },
  warning: { marginTop: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, gap: Spacing.xs },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  warningText: { ...Typography.caption, flex: 1, fontWeight: '600' },
  warningFoot: { ...Typography.caption, opacity: 0.8 },
});
