import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, useColorScheme, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import { Spacing, Radius, Typography } from '../constants/Layout';

export interface QuickEntryResult {
  filled: string[];
  missing: string[];
}

interface QuickEntryProps {
  /** Parse the text and fill the form; resolves with what was filled. */
  onSubmit: (text: string) => Promise<QuickEntryResult>;
  autoFocus?: boolean;
}

/**
 * "Describe your expense" box. Voice works through the iPhone keyboard's dictation mic,
 * which is reliable in both the home-screen web app and the native app.
 */
export function QuickEntry({ onSubmit, autoFocus }: QuickEntryProps) {
  const colors = Colors[useColorScheme() ?? 'dark'];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuickEntryResult | null>(null);

  const canSubmit = text.trim().length >= 3 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      setResult(await onSubmit(text.trim()));
    } finally {
      setBusy(false);
    }
  };

  const nothingFound = result !== null && result.filled.length === 0;

  return (
    <View style={[styles.card, { backgroundColor: colors.primaryLight, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <Ionicons name="mic-outline" size={14} color={colors.primary} />
        <Text style={[styles.label, { color: colors.primary }]}>DESCRIBE IT</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>type, or tap the mic on your keyboard</Text>
      </View>

      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={t => {
            setText(t);
            if (result) setResult(null);
          }}
          placeholder="e.g. Dinner $84 with Rahul and Priya, paid with Zelle"
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceHigh, borderColor: colors.border }]}
          multiline
          submitBehavior="blurAndSubmit"
          onSubmitEditing={submit}
          onKeyPress={e => {
            // react-native-web ignores submitBehavior on multiline inputs: make Return submit there too
            if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !(e.nativeEvent as { shiftKey?: boolean }).shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          returnKeyType="done"
          autoFocus={autoFocus}
          maxLength={300}
          accessibilityLabel="Describe your expense"
        />
        <TouchableOpacity
          onPress={submit}
          disabled={!canSubmit}
          style={[styles.fillButton, { backgroundColor: canSubmit ? colors.primary : colors.surfaceHigh }]}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Fill form from description"
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Text style={[styles.fillText, { color: canSubmit ? colors.background : colors.textSecondary }]}>Fill</Text>
          )}
        </TouchableOpacity>
      </View>

      {result && !nothingFound ? (
        <Text style={[styles.result, { color: colors.text }]}>
          <Text style={{ color: colors.primary, fontWeight: '700' }}>Filled {result.filled.join(', ')}</Text>
          {result.missing.length ? ` · add ${result.missing.join(', ')} below` : ' · check below, then save'}
        </Text>
      ) : null}
      {nothingFound ? (
        <Text style={[styles.result, { color: colors.pending }]}>
          Couldn't pick anything out. Try something like "Lunch $30 with Sam".
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.md, gap: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  label: { ...Typography.caption, fontWeight: '700', letterSpacing: 1 },
  hint: { ...Typography.caption, marginLeft: Spacing.xs },
  inputRow: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.sm },
  input: {
    flex: 1,
    ...Typography.body,
    minHeight: 48,
    maxHeight: 110,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    textAlignVertical: 'top',
  },
  fillButton: { borderRadius: Radius.md, paddingHorizontal: Spacing.lg, alignItems: 'center', justifyContent: 'center', minWidth: 64 },
  fillText: { ...Typography.body, fontWeight: '700' },
  result: { ...Typography.caption, lineHeight: 18 },
});
