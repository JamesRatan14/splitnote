import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  TextInput,
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
    visible ? (
      <View style={styles.overlay} accessibilityViewIsModal>
        <View style={[StyleSheet.absoluteFill, styles.dim]} />
        <View style={[styles.sheet, styles.progressSheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + Spacing.xl }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.status, { color: colors.text }]}>{label}</Text>
        </View>
      </View>
    ) : null
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
  /** Fallback when voice fails: typed (or keyboard-dictated) text goes through the same path. */
  onTypeSubmit?: (text: string) => void;
}

/** Google-style listening sheet: pulsing mic, live transcript, Done / Cancel. */
export function VoiceSheet({
  visible,
  listening,
  processing,
  transcript,
  error,
  onStop,
  onCancel,
  onRetry,
  onTypeSubmit,
}: VoiceSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [typed, setTyped] = useState('');
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!visible) {
      setTyped('');
      setTyping(false);
    }
  }, [visible]);
  const submitTyped = () => {
    const t = typed.trim();
    if (t.length >= 2 && onTypeSubmit) onTypeSubmit(t);
  };
  const showTyping = !!error && !processing && !!onTypeSubmit;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // The pulsing ring runs on the native driver only; on web a per-frame JS animation competes with
    // speech recognition on the main thread, so the ring is shown static there.
    if (!listening || Platform.OS === 'web') {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [listening, pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  const status = processing
    ? 'Understanding…'
    : error
      ? null
      : listening
        ? transcript
          ? null
          : 'Listening…'
        : transcript
          ? 'Got it'
          : 'Starting…';

  return (
    visible ? (
      // A plain overlay inside the screen (not RN <Modal>): on iOS home-screen web apps the Modal
      // portal can be laid out against the wrong viewport, leaving its buttons untappable.
      <View style={[styles.overlay, typing && styles.overlayTop]} accessibilityViewIsModal>
        <Pressable style={[StyleSheet.absoluteFill, styles.dim]} onPress={onCancel} accessibilityLabel="Cancel voice input" />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, paddingBottom: insets.bottom + Spacing.xl },
            // keep the text box above the on-screen keyboard
            typing && { paddingTop: insets.top + Spacing.lg, paddingBottom: Spacing.xl, borderRadius: 0, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
          ]}
        >
          <View style={styles.micWrap}>
            {listening && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.ring,
                  Platform.OS === 'web'
                    ? { backgroundColor: colors.primary, opacity: 0.25, transform: [{ scale: 1.35 }] }
                    : { backgroundColor: colors.primary, opacity: ringOpacity, transform: [{ scale: ringScale }] },
                ]}
              />
            )}
            <Pressable
              onPress={error ? onRetry : listening ? onStop : onRetry}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={error ? 'Try again' : listening ? 'Stop listening' : 'Start listening'}
              style={({ pressed }) => [styles.micCircle, { backgroundColor: error ? colors.surfaceHigh : colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name={error ? 'refresh' : 'mic'} size={36} color={error ? colors.text : colors.background} />
            </Pressable>
          </View>

          {processing ? <ActivityIndicator color={colors.primary} /> : null}
          {status ? <Text style={[styles.status, { color: colors.textSecondary }]}>{status}</Text> : null}
          {transcript ? (
            <Text style={[styles.transcript, { color: colors.text }]} accessibilityLiveRegion="polite">
              {transcript}
            </Text>
          ) : null}
          {error && !processing ? <Text style={[styles.error, { color: colors.pending }]}>{error}</Text> : null}
          {showTyping ? (
            <View style={styles.typeRow}>
              <TextInput
                value={typed}
                onChangeText={setTyped}
                placeholder="Or type it here"
                placeholderTextColor={colors.textSecondary}
                onSubmitEditing={submitTyped}
                // Stay at the top once typing starts (until the sheet closes): moving back on blur would
                // shift the Fill button out from under the finger mid-tap.
                onFocus={() => setTyping(true)}
                returnKeyType="done"
                maxLength={600}
                style={[styles.typeInput, { color: colors.text, backgroundColor: colors.surfaceHigh, borderColor: colors.border }]}
                accessibilityLabel="Type the expense"
              />
              <Pressable
                onPress={submitTyped}
                hitSlop={8}
                style={[styles.typeButton, { backgroundColor: typed.trim().length >= 2 ? colors.primary : colors.surfaceHigh }]}
                accessibilityRole="button"
                accessibilityLabel="Fill from typed text"
              >
                <Text style={[styles.typeButtonText, { color: typed.trim().length >= 2 ? colors.background : colors.textSecondary }]}>Fill</Text>
              </Pressable>
            </View>
          ) : null}
          {!transcript && !error ? (
            <Text style={[styles.example, { color: colors.textSecondary }]}>
              Try “Dinner 84 dollars with Rahul and Priya, paid with Zelle”
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable onPress={onCancel} hitSlop={12} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel="Cancel">
              <Text style={[styles.actionText, { color: colors.textSecondary }]}>Cancel</Text>
            </Pressable>
            {listening ? (
              <Pressable onPress={onStop} hitSlop={12} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel="Done">
                <Text style={[styles.actionText, { color: colors.primary, fontWeight: '700' }]}>Done</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    ) : null
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
  typeRow: { flexDirection: 'row', alignSelf: 'stretch', gap: Spacing.sm },
  typeInput: { flex: 1, ...Typography.body, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  typeButton: { borderRadius: Radius.md, paddingHorizontal: Spacing.lg, alignItems: 'center', justifyContent: 'center' },
  typeButtonText: { ...Typography.body, fontWeight: '700' },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 1000, justifyContent: 'flex-end' },
  overlayTop: { justifyContent: 'flex-start' },
  dim: { backgroundColor: 'rgba(0,0,0,0.55)' },
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
  actionBtn: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, minWidth: 88, alignItems: 'center' },
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
