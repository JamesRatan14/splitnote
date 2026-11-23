import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import { Radius, Spacing, Typography } from '../constants/Layout';
import { useAiSettings } from '../hooks/useAiSettings';
import { AiError, aiCheck, isAiReady } from '../utils/ai/client';

type Status = { kind: 'idle' } | { kind: 'checking' } | { kind: 'ok'; model: string } | { kind: 'error'; message: string };

/** Settings → AI: proxy URL + passphrase (stored on-device), with a no-cost connection test. */
export function AiSettingsCard() {
  const colors = Colors[useColorScheme() ?? 'dark'];
  const { settings, loaded, save } = useAiSettings();
  const [url, setUrl] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    if (loaded) {
      setUrl(settings.url);
      setPassphrase(settings.passphrase);
    }
  }, [loaded, settings.url, settings.passphrase]);

  const dirty = url.trim() !== settings.url || passphrase !== settings.passphrase;

  const saveAndTest = async () => {
    const next = { url: url.trim(), passphrase };
    await save(next);
    if (!isAiReady(next)) {
      setStatus({ kind: 'error', message: 'Enter an https:// URL and the passphrase' });
      return;
    }
    setStatus({ kind: 'checking' });
    try {
      const { model } = await aiCheck(next);
      setStatus({ kind: 'ok', model });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof AiError ? e.message : 'Connection failed' });
    }
  };

  const ready = isAiReady(settings);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.headRow}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
          <Ionicons name="sparkles-outline" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Claude (voice + receipts)</Text>
          <Text style={[styles.sub, { color: ready ? colors.primary : colors.textSecondary }]}>
            {ready ? 'Set up · voice uses Claude, receipts enabled' : 'Not set up · voice uses the offline parser'}
          </Text>
        </View>
      </View>

      <Text style={[styles.label, { color: colors.textSecondary }]}>SERVER URL</Text>
      <TextInput
        value={url}
        onChangeText={t => {
          setUrl(t);
          setStatus({ kind: 'idle' });
        }}
        placeholder="https://splitnote-ai.vercel.app"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceHigh, borderColor: colors.border }]}
        accessibilityLabel="AI server URL"
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>PASSPHRASE</Text>
      <TextInput
        value={passphrase}
        onChangeText={t => {
          setPassphrase(t);
          setStatus({ kind: 'idle' });
        }}
        placeholder="The passphrase you set on the server"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceHigh, borderColor: colors.border }]}
        accessibilityLabel="AI server passphrase"
      />

      <TouchableOpacity
        onPress={saveAndTest}
        disabled={status.kind === 'checking'}
        style={[styles.button, { backgroundColor: colors.primary }]}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        {status.kind === 'checking' ? (
          <ActivityIndicator color={colors.background} />
        ) : (
          <Text style={[styles.buttonText, { color: colors.background }]}>{dirty ? 'Save & test' : 'Test connection'}</Text>
        )}
      </TouchableOpacity>

      {status.kind === 'ok' ? (
        <Text style={[styles.status, { color: colors.primary }]}>Connected · {status.model}</Text>
      ) : null}
      {status.kind === 'error' ? <Text style={[styles.status, { color: colors.danger }]}>{status.message}</Text> : null}

      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        The passphrase stays on this device. Your Claude API key lives only on your server. Testing doesn't use any Claude credit.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.lg, gap: Spacing.sm, marginBottom: Spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.xs },
  iconWrap: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.body, fontWeight: '600' },
  sub: { ...Typography.caption, marginTop: 2 },
  label: { ...Typography.caption, fontWeight: '700', letterSpacing: 1, marginTop: Spacing.xs },
  input: { ...Typography.body, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  button: { marginTop: Spacing.sm, borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center' },
  buttonText: { ...Typography.body, fontWeight: '700' },
  status: { ...Typography.caption, fontWeight: '600' },
  hint: { ...Typography.caption, lineHeight: 17 },
});
