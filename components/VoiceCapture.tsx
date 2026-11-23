import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/Colors';
import { Radius, Spacing, Typography } from '../constants/Layout';

function useColors() {
  return Colors[useColorScheme() ?? 'dark'];
}

/** Floating round mic button. */
export function VoiceMicButton({ onPress, bottom }: { onPress: () => void; bottom: number }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Say an expense"
      style={[styles.fab, { bottom, backgroundColor: colors.primary, shadowColor: colors.primary }]}
    >
      <Ionicons name="mic" size={28} color={colors.background} />
    </TouchableOpacity>
  );
}

/** Smaller floating camera button (sits above the mic). */
export function ReceiptButton({ onPress, bottom }: { onPress: () => void; bottom: number }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Scan a receipt"
      style={[styles.fabSmall, { bottom, backgroundColor: colors.surfaceHigh, borderColor: colors.primary }]}
    >
      <Ionicons name="camera" size={22} color={colors.primary} />
    </TouchableOpacity>
  );
}

/** Blocking "working…" sheet (e.g. reading a receipt). */
export function ProgressSheet({ visible, label }: { visible: boolean; label: string }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={[styles.sheet, styles.progressSheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + Spacing.xl }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.status, { color: colors.text }]}>{label}</Text>
        </View>
      </View>
    </Modal>
  );
}

interface VoiceSheetProps {
  visible: boolean;
  listening: boolean;
  /** Speech is done and the text is being understood (e.g. by Claude). */
  processing?: boolean;
  transcript: string;
  error: string | null;
  onStop: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

/** Google-style listening sheet: pulsing mic, live transcript, Done / Cancel. */
export function VoiceSheet({ visible, listening, processing, transcript, error, onStop, onCancel, onRetry }: VoiceSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!listening) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      })
    );
    loop.start();
    return () => loop.stop();
  }, [listening, pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  const status = error
    ? null
    : processing
      ? 'Understanding…'
      : listening
        ? transcript
          ? null
          : 'Listening…'
        : transcript
          ? 'Got it'
          : 'Starting…';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onCancel} accessibilityLabel="Cancel voice input">
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => undefined}
          style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + Spacing.xl }]}
        >
          <View style={styles.micWrap}>
            {listening && (
              <Animated.View
                style={[
                  styles.ring,
                  { backgroundColor: colors.primary, opacity: ringOpacity, transform: [{ scale: ringScale }] },
                ]}
              />
            )}
            <TouchableOpacity
              onPress={error ? onRetry : listening ? onStop : onRetry}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={error ? 'Try again' : listening ? 'Stop listening' : 'Start listening'}
              style={[styles.micCircle, { backgroundColor: error ? colors.surfaceHigh : colors.primary }]}
            >
              <Ionicons name={error ? 'refresh' : 'mic'} size={36} color={error ? colors.text : colors.background} />
            </TouchableOpacity>
          </View>

          {processing ? <ActivityIndicator color={colors.primary} /> : null}
          {status ? <Text style={[styles.status, { color: colors.textSecondary }]}>{status}</Text> : null}
          {transcript ? (
            <Text style={[styles.transcript, { color: colors.text }]} accessibilityLiveRegion="polite">
              {transcript}
            </Text>
          ) : null}
          {error ? <Text style={[styles.error, { color: colors.pending }]}>{error}</Text> : null}
          {!transcript && !error ? (
            <Text style={[styles.example, { color: colors.textSecondary }]}>
              Try “Dinner 84 dollars with Rahul and Priya, paid with Zelle”
            </Text>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity onPress={onCancel} style={styles.actionBtn} accessibilityRole="button">
              <Text style={[styles.actionText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            {listening ? (
              <TouchableOpacity onPress={onStop} style={styles.actionBtn} accessibilityRole="button">
                <Text style={[styles.actionText, { color: colors.primary, fontWeight: '700' }]}>Done</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export interface FillResult {
  filled: string[];
  missing: string[];
  /** What the user said (voice) — omitted for receipts. */
  heard?: string;
  /** e.g. "via Claude · 1.8s" or "offline parser · AI server unreachable". */
  source: string;
  /** Set when nothing could be filled (e.g. the receipt could not be read). */
  error?: string;
}

/** Small banner shown after voice / a receipt fills the form. */
export function VoiceResultBanner({ heard, filled, missing, source, error, onDismiss }: FillResult & { onDismiss: () => void }) {
  const colors = useColors();
  const nothing = filled.length === 0;
  return (
    <View style={[styles.banner, { backgroundColor: nothing ? colors.pendingLight : colors.primaryLight }]}>
      <Ionicons name={nothing ? 'help-circle-outline' : 'checkmark-circle'} size={18} color={nothing ? colors.pending : colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.bannerTitle, { color: nothing ? colors.pending : colors.primary }]}>
          {error
            ? error
            : nothing
              ? "Couldn't pick out an expense. Try again or fill it in below."
              : `Filled ${filled.join(', ')}${missing.length ? ` · add ${missing.join(', ')}` : ' · check and save'}`}
        </Text>
        {heard ? (
          <Text style={[styles.bannerHeard, { color: colors.textSecondary }]} numberOfLines={2}>
            Heard: “{heard}”
          </Text>
        ) : null}
        <Text style={[styles.bannerHeard, { color: colors.textSecondary }]} accessibilityLabel={`Source: ${source}`}>
          {source}
        </Text>
      </View>
      <TouchableOpacity onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={10}>
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const MIC = 84;

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: Spacing.xl,
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  fabSmall: {
    position: 'absolute',
    right: Spacing.xl + 8,
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressSheet: { minHeight: 200, justifyContent: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    paddingTop: Spacing.xxxl,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 320,
  },
  micWrap: { width: MIC * 1.9, height: MIC * 1.9, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: MIC, height: MIC, borderRadius: MIC / 2 },
  micCircle: { width: MIC, height: MIC, borderRadius: MIC / 2, alignItems: 'center', justifyContent: 'center' },
  status: { ...Typography.body },
  transcript: { ...Typography.h3, textAlign: 'center', lineHeight: 24 },
  example: { ...Typography.caption, textAlign: 'center' },
  error: { ...Typography.body, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: Spacing.xxl, marginTop: Spacing.sm },
  actionBtn: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg },
  actionText: { ...Typography.body },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  bannerTitle: { ...Typography.caption, fontWeight: '700' },
  bannerHeard: { ...Typography.caption, marginTop: 2 },
});
