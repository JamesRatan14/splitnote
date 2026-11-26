import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  useColorScheme,
} from 'react-native';
import { showAlert } from '../../utils/alert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import WebDateInput from '../../components/WebDateInput';
import * as Haptics from 'expo-haptics';
import { useTransactions } from '../../hooks/useTransactions';
import { useFriendSuggestions } from '../../hooks/useFriendSuggestions';
import { AmountInput } from '../../components/AmountInput';
import { ModeSelector } from '../../components/ModeSelector';
import { ParticipantInput } from '../../components/ParticipantInput';
import { AnomalyWarnings, CategoryHint, FriendSuggestions, ModeHint } from '../../components/SmartHints';
import { useExpenseSuggestions } from '../../hooks/useExpenseSuggestions';
import { FillResult, ProgressSheet, ReceiptButton, VoiceMicButton, VoiceResultBanner, VoiceSheet } from '../../components/VoiceCapture';
import { useAiSettings } from '../../hooks/useAiSettings';
import { useReceiptScan } from '../../hooks/useReceiptScan';
import { DraftForAi, isAiReady } from '../../utils/ai/client';
import type { ParsedExpense } from '../../utils/ml';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { describeFilled, parseExpense, ParseResult } from '../../utils/parseExpense';
import { Colors } from '../../constants/Colors';
import { Spacing, Radius, Typography } from '../../constants/Layout';
import { DEFAULT_PAYMENT_MODE } from '../../constants/PaymentModes';
import { PaymentMode, SplitType, TaxSplitType } from '../../types';
import { todayISO, formatDate } from '../../utils/formatters';

interface FormErrors {
  title?: string;
  amount?: string;
  tax?: string;
  participants?: string;
  customAmounts?: string;
  customTaxAmounts?: string;
  note?: string;
}

export default function NewTransactionScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const colors = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { transactions, addTransaction } = useTransactions();
  const { knownFriends, getSuggestions, updateFriends } = useFriendSuggestions();

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>(DEFAULT_PAYMENT_MODE);
  const [date, setDate] = useState(todayISO());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [includeMe, setIncludeMe] = useState(false);
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [tax, setTax] = useState('');
  const [taxSplitType, setTaxSplitType] = useState<TaxSplitType>('equal');
  const [customTaxAmounts, setCustomTaxAmounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceResult, setVoiceResult] = useState<FillResult | null>(null);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  // bumps on every open/cancel, so a late answer from a cancelled session is ignored
  const voiceSession = useRef(0);
  const { settings: ai } = useAiSettings();
  const receipt = useReceiptScan(ai);
  const [saveBarHeight, setSaveBarHeight] = useState(0);

  const suggestions = useExpenseSuggestions(
    { title, amount: parseFloat(amount) || 0, date, mode, participants },
    transactions
  );

  const hasChanges = title.trim() !== '' || amount !== '' || participants.length > 0 || note.trim() !== '';

  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (title.trim().length < 2) {
      newErrors.title = 'Title must be at least 2 characters';
    } else if (title.trim().length > 80) {
      newErrors.title = 'Title must be 80 characters or fewer';
    }

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      newErrors.amount = 'Enter a valid amount';
    } else if (amountNum > 1000000) {
      newErrors.amount = 'Amount cannot exceed $1,000,000';
    }

    const taxNum = parseFloat(tax) || 0;
    if (tax !== '' && (isNaN(taxNum) || taxNum < 0)) {
      newErrors.tax = 'Enter a valid tax amount';
    }

    if (participants.length === 0) {
      newErrors.participants = 'Add at least one participant';
    }

    if (taxNum > 0 && taxSplitType === 'custom' && participants.length > 0) {
      const missing = participants.some(p => !customTaxAmounts[p] || parseFloat(customTaxAmounts[p]) < 0);
      if (missing) newErrors.customTaxAmounts = 'Enter a tax amount for each person (can be $0)';
    }

    if (splitType === 'custom' && participants.length > 0) {
      const total = participants.reduce((s, p) => s + (parseFloat(customAmounts[p] ?? '0') || 0), 0);
      const amountN = parseFloat(amount) || 0;
      const missing = participants.some(p => !customAmounts[p] || parseFloat(customAmounts[p]) <= 0);
      if (missing) {
        newErrors.customAmounts = 'Enter an amount for each person';
      } else if (total > amountN) {
        newErrors.customAmounts = `Custom amounts ($${total.toFixed(2)}) exceed the total ($${amountN.toFixed(2)})`;
      }
    }

    if (note.length > 200) {
      newErrors.note = 'Note must be 200 characters or fewer';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [title, amount, tax, taxSplitType, customTaxAmounts, participants, splitType, customAmounts, note]);

  const handleSave = useCallback(async () => {
    if (!validate()) return;
    setIsSaving(true);
    try {
      const amountNum = parseFloat(amount);
      const cleanParticipants = participants
        .map(p => p.trim())
        .filter((p, i, arr) => arr.findIndex(x => x.toLowerCase() === p.toLowerCase()) === i);

      const parsedCustomAmounts: Record<string, number> = {};
      if (splitType === 'custom') {
        for (const p of cleanParticipants) {
          parsedCustomAmounts[p] = Math.round((parseFloat(customAmounts[p] ?? '0') || 0) * 100) / 100;
        }
      }

      const taxNum = Math.round((parseFloat(tax) || 0) * 100) / 100;
      const parsedCustomTax: Record<string, number> = {};
      if (taxNum > 0 && taxSplitType === 'custom') {
        for (const p of cleanParticipants) {
          parsedCustomTax[p] = Math.round((parseFloat(customTaxAmounts[p] ?? '0') || 0) * 100) / 100;
        }
      }

      await addTransaction({
        title: title.trim(),
        amount: Math.round(amountNum * 100) / 100,
        mode,
        date,
        participants: cleanParticipants,
        splitType,
        includeMe,
        customAmounts: splitType === 'custom' ? parsedCustomAmounts : undefined,
        tax: taxNum > 0 ? taxNum : undefined,
        taxSplitType: taxNum > 0 ? taxSplitType : undefined,
        customTaxAmounts: taxNum > 0 && taxSplitType === 'custom' ? parsedCustomTax : undefined,
        note: note.trim() || undefined,
      });

      await updateFriends(cleanParticipants);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      console.error('Save failed', e);
      showAlert('Error', 'Failed to save transaction. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [validate, amount, tax, taxSplitType, customTaxAmounts, includeMe, participants, title, mode, date, splitType, customAmounts, note, addTransaction, updateFriends]);

  const handleBack = useCallback(() => {
    if (hasChanges) {
      showAlert('Discard Changes?', 'You have unsaved changes. Are you sure you want to discard them?', [
        { text: 'Keep Editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  }, [hasChanges]);

  const handleDateChange = (_event: DateTimePickerEvent, selected?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selected) {
      const y = selected.getFullYear();
      const m = String(selected.getMonth() + 1).padStart(2, '0');
      const d = String(selected.getDate()).padStart(2, '0');
      setDate(`${y}-${m}-${d}`);
    }
  };

  // Fill whatever the parser / Claude found. Nothing is saved: the user reviews everything first.
  const applyParsed = useCallback((parsed: ParsedExpense): { filled: string[]; missing: string[] } => {
    if (parsed.title) setTitle(parsed.title.slice(0, 80));
    if (parsed.amount !== undefined && parsed.amount > 0) setAmount(String(parsed.amount));
    if (parsed.tax !== undefined && parsed.tax > 0) setTax(String(parsed.tax));
    if (parsed.mode) setMode(parsed.mode);
    if (parsed.date) setDate(parsed.date);
    if (parsed.participants.length > 0) {
      const unique = parsed.participants
        .map(n => n.trim())
        .filter((n, i, arr) => n && arr.findIndex(x => x.toLowerCase() === n.toLowerCase()) === i)
        .slice(0, 20);
      setParticipants(unique);
      setIncludeMe(parsed.includeMe);
      setCustomTaxAmounts({});
      if (parsed.splitType === 'custom' && parsed.customAmounts) {
        const shares: Record<string, string> = {};
        for (const [name, value] of Object.entries(parsed.customAmounts)) shares[name] = String(value);
        setSplitType('custom');
        setCustomAmounts(shares);
      } else {
        setSplitType('equal');
        setCustomAmounts({});
      }
    } else if (parsed.includeMe) {
      setIncludeMe(true);
    }
    const parsedNote = parsed.note;
    if (parsedNote) setNote(prev => (prev.trim() ? prev : parsedNote.slice(0, 200)));
    setErrors({});
    const summary = describeFilled(parsed);
    if (summary.filled.length > 0) Haptics.selectionAsync().catch(() => undefined);
    return summary;
  }, []);

  const sourceLabel = (r: ParseResult): string =>
    r.source === 'llm'
      ? `via Claude${r.latencyMs ? ` · ${(r.latencyMs / 1000).toFixed(1)}s` : ''}`
      : `offline parser${r.fallbackReason ? ` · ${r.fallbackReason}` : ''}`;

  // Snapshot of the form for "edit by voice"; undefined when the form is still empty.
  const draftRef = useRef<() => DraftForAi | undefined>(() => undefined);
  draftRef.current = () => {
    const amountValue = parseFloat(amount);
    const taxValue = parseFloat(tax);
    if (!title.trim() && !(amountValue > 0) && participants.length === 0) return undefined;
    return {
      title: title.trim() || undefined,
      amount: amountValue > 0 ? amountValue : undefined,
      tax: taxValue > 0 ? taxValue : undefined,
      mode,
      date,
      participants,
      includeMe,
      note: note.trim() || undefined,
    };
  };
  const currentDraft = () => draftRef.current();

  // What was said (or typed in the fallback box) → Claude (or offline parser) → form
  const understand = useCallback(
    (heard: string) => {
      const session = voiceSession.current;
      setVoiceProcessing(true);
      parseExpense(heard, knownFriends, ai, currentDraft())
        .then(r => {
          if (session !== voiceSession.current) return; // cancelled meanwhile
          setVoiceResult({ heard, ...applyParsed(r.parsed), source: sourceLabel(r) });
        })
        .finally(() => {
          if (session !== voiceSession.current) return;
          setVoiceProcessing(false);
          setVoiceOpen(false);
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [knownFriends, ai, applyParsed]
  );

  const voice = useVoiceInput(understand, knownFriends);

  const openVoice = () => {
    voiceSession.current += 1;
    setVoiceResult(null);
    setVoiceOpen(true);
    voice.start(); // synchronous inside the tap (required by Safari)
  };

  const closeVoice = () => {
    voiceSession.current += 1;
    voice.cancel();
    setVoiceProcessing(false);
    setVoiceOpen(false);
  };

  const runReceipt = (source: 'camera' | 'library') => {
    setVoiceResult(null);
    receipt.scan(source).then(out => {
      if (out.kind === 'cancelled') return;
      if (out.kind === 'error') {
        setVoiceResult({ filled: [], missing: [], source: 'receipt', error: out.message });
        return;
      }
      const summary = applyParsed(out.result.parsed);
      const ms = out.result.meta?.latencyMs;
      setVoiceResult({
        filled: summary.filled,
        // a receipt never names friends; only ask for them if none are added yet
        missing: summary.missing.filter(m => m !== 'friends' || participants.length === 0),
        source: `receipt via Claude${ms ? ` · ${(ms / 1000).toFixed(1)}s` : ''}`,
      });
    });
  };

  const openReceipt = () => {
    if (!isAiReady(ai)) {
      showAlert('Set up AI first', 'Receipt scanning uses Claude. Add your AI server URL and passphrase in Settings → AI.');
      return;
    }
    if (Platform.OS === 'web') {
      runReceipt('library'); // the browser's picker offers "Take Photo" on iPhone; must open inside the tap
      return;
    }
    showAlert('Scan receipt', undefined, [
      { text: 'Take Photo', onPress: () => runReceipt('camera') },
      { text: 'Choose from Library', onPress: () => runReceipt('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const addParticipant = (name: string) => {
    setParticipants(prev => [...prev, name]);
    if (errors.participants) setErrors(prev => ({ ...prev, participants: undefined }));
  };

  const removeParticipant = (name: string) => {
    setParticipants(prev => prev.filter(p => p !== name));
    setCustomAmounts(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const dateObj = new Date(date + 'T00:00:00');

  const amountNum = parseFloat(amount) || 0;
  const taxNum = parseFloat(tax) || 0;
  const totalNum = amountNum + taxNum;
  const splitPeople = includeMe ? participants.length + 1 : participants.length;
  const equalShare = splitPeople > 0 ? Math.round((totalNum / splitPeople) * 100) / 100 : 0;
  const friendShare = includeMe ? equalShare : (participants.length > 0 ? Math.round((totalNum / participants.length) * 100) / 100 : 0);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
            paddingTop: insets.top,
          },
        ]}
      >
        <TouchableOpacity onPress={handleBack} style={styles.headerButton}>
          <Text style={[styles.headerButtonText, { color: colors.primary }]}>Cancel</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>New Expense</Text>
        <TouchableOpacity onPress={handleSave} style={styles.headerButton} disabled={isSaving}>
          <Text style={[styles.headerButtonText, { color: isSaving ? colors.textSecondary : colors.primary, fontWeight: '700' }]}>
            {isSaving ? 'Saving...' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 200 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Result of the last voice entry */}
        {voiceResult ? (
          <View style={styles.field}>
            <VoiceResultBanner {...voiceResult} onDismiss={() => setVoiceResult(null)} />
          </View>
        ) : null}

        {/* Title */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>TITLE *</Text>
          <TextInput
            value={title}
            onChangeText={text => { setTitle(text); if (errors.title) setErrors(prev => ({ ...prev, title: undefined })); }}
            placeholder="e.g. Dinner at Nobu"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.textInput,
              {
                color: colors.text,
                backgroundColor: colors.surfaceHigh,
                borderColor: errors.title ? colors.danger : colors.border,
              },
            ]}
            returnKeyType="next"
            maxLength={80}
          />
          {errors.title ? <Text style={[styles.errorText, { color: colors.danger }]}>{errors.title}</Text> : null}
          <CategoryHint category={suggestions.category} />
        </View>

        {/* Amount */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>AMOUNT *</Text>
          <AmountInput
            value={amount}
            onChangeText={text => { setAmount(text); if (errors.amount) setErrors(prev => ({ ...prev, amount: undefined })); }}
            error={errors.amount}
          />
          <AnomalyWarnings warnings={suggestions.warnings} />
        </View>

        {/* Tax */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            TAX <Text style={{ fontWeight: '400', textTransform: 'none' }}>(optional)</Text>
          </Text>
          <View style={[styles.taxInputRow, { backgroundColor: colors.surfaceHigh, borderColor: errors.tax ? colors.danger : colors.border }]}>
            <Text style={[styles.taxPrefix, { color: colors.pending }]}>$</Text>
            <TextInput
              value={tax}
              onChangeText={text => {
                const cleaned = text.replace(/[^0-9.]/g, '').replace(/(\..*?)\..*/g, '$1');
                setTax(cleaned);
                if (errors.tax) setErrors(prev => ({ ...prev, tax: undefined }));
              }}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textSecondary}
              style={[styles.taxField, { color: colors.text }]}
            />
          </View>
          {errors.tax ? <Text style={[styles.errorText, { color: colors.danger }]}>{errors.tax}</Text> : null}

          {/* Tax split type — only when tax > 0 and participants exist */}
          {(parseFloat(tax) || 0) > 0 && participants.length > 0 && (
            <View style={styles.taxSplitSection}>
              <Text style={[styles.taxSplitLabel, { color: colors.textSecondary }]}>HOW TO SPLIT TAX</Text>
              <View style={[styles.taxToggle, { backgroundColor: colors.surfaceHigh, borderColor: colors.border }]}>
                {(['equal', 'proportional', 'custom'] as TaxSplitType[]).map(opt => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.taxOption, taxSplitType === opt && { backgroundColor: colors.pending }]}
                    onPress={() => setTaxSplitType(opt)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.taxOptionText, { color: taxSplitType === opt ? '#FFFFFF' : colors.textSecondary }]}>
                      {opt === 'equal' ? 'Equal' : opt === 'proportional' ? 'By Items' : 'Custom'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {taxSplitType === 'proportional' && (
                <View style={[styles.taxHint, { backgroundColor: colors.pendingLight }]}>
                  <Text style={[styles.taxHintText, { color: colors.pending }]}>
                    Tax split proportionally based on each person's item amount
                  </Text>
                </View>
              )}

              {taxSplitType === 'custom' && (
                <View style={styles.customAmountsContainer}>
                  {participants.map(name => (
                    <View key={name} style={styles.customAmountRow}>
                      <Text style={[styles.customAmountName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
                      <View style={[styles.customAmountInput, { backgroundColor: colors.surfaceHigh, borderColor: errors.customTaxAmounts ? colors.danger : colors.border }]}>
                        <Text style={[styles.customAmountPrefix, { color: colors.pending }]}>$</Text>
                        <TextInput
                          value={customTaxAmounts[name] ?? ''}
                          onChangeText={text => {
                            const cleaned = text.replace(/[^0-9.]/g, '');
                            setCustomTaxAmounts(prev => ({ ...prev, [name]: cleaned }));
                            if (errors.customTaxAmounts) setErrors(prev => ({ ...prev, customTaxAmounts: undefined }));
                          }}
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                          placeholderTextColor={colors.textSecondary}
                          style={[styles.customAmountField, { color: colors.text }]}
                        />
                      </View>
                    </View>
                  ))}
                  {errors.customTaxAmounts ? <Text style={[styles.errorText, { color: colors.danger }]}>{errors.customTaxAmounts}</Text> : null}
                </View>
              )}
            </View>
          )}
        </View>

        {/* Payment Mode */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>PAYMENT MODE *</Text>
          <ModeSelector selected={mode} onSelect={setMode} />
          <ModeHint mode={suggestions.mode} onApply={setMode} />
        </View>

        {/* Date */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>DATE *</Text>
          {Platform.OS === 'web' ? (
            <WebDateInput
              value={date}
              max={todayISO()}
              onChange={setDate}
              backgroundColor={colors.surfaceHigh}
              borderColor={colors.border}
              color={colors.text}
              dark={colorScheme === 'dark'}
            />
          ) : (
            <>
            <TouchableOpacity
              onPress={() => setShowDatePicker(true)}
              style={[
                styles.dateButton,
                {
                  backgroundColor: colors.surfaceHigh,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.dateText, { color: colors.text }]}>{formatDate(date)}</Text>
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={dateObj}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={handleDateChange}
                maximumDate={new Date()}
                themeVariant={colorScheme}
              />
            )}
            </>
          )}
        </View>

        {/* Participants */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>WHO PAID WITH YOU? *</Text>
          <ParticipantInput
            participants={participants}
            onAdd={addParticipant}
            onRemove={removeParticipant}
            getSuggestions={getSuggestions}
            error={errors.participants}
          />
          <FriendSuggestions names={suggestions.friends} onAdd={addParticipant} />
        </View>

        {/* Split Type — only show when there are participants */}
        {participants.length > 0 && (
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>HOW TO SPLIT *</Text>
            <View
              style={[
                styles.splitToggle,
                {
                  backgroundColor: colors.surfaceHigh,
                  borderColor: colors.border,
                },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.splitOption,
                  splitType === 'equal' && { backgroundColor: colors.primary },
                ]}
                onPress={() => setSplitType('equal')}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.splitOptionText,
                    { color: splitType === 'equal' ? '#FFFFFF' : colors.textSecondary },
                  ]}
                >
                  Equal Split
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.splitOption,
                  splitType === 'custom' && { backgroundColor: colors.primary },
                ]}
                onPress={() => setSplitType('custom')}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.splitOptionText,
                    { color: splitType === 'custom' ? '#FFFFFF' : colors.textSecondary },
                  ]}
                >
                  Custom Split
                </Text>
              </TouchableOpacity>
            </View>

            {/* Include me checkbox */}
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setIncludeMe(v => !v)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: colors.primary,
                    backgroundColor: includeMe ? colors.primary : 'transparent',
                  },
                ]}
              >
                {includeMe && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={[styles.checkboxLabel, { color: colors.text }]}>Include me in the split</Text>
            </TouchableOpacity>

            {/* Equal split preview */}
            {splitType === 'equal' && amountNum > 0 && (
              <View style={[styles.splitPreview, { backgroundColor: colors.primaryLight }]}>
                <Text style={[styles.splitPreviewText, { color: colors.primary }]}>
                  {includeMe
                    ? `Each person pays $${equalShare.toFixed(2)} · ${splitPeople} people · You collect $${(equalShare * participants.length).toFixed(2)}`
                    : `Each friend pays $${friendShare.toFixed(2)} · You collect $${totalNum.toFixed(2)}`}
                </Text>
              </View>
            )}

            {/* Custom amounts per person */}
            {splitType === 'custom' && (
              <View style={styles.customAmountsContainer}>
                {participants.map(name => (
                  <View key={name} style={styles.customAmountRow}>
                    <Text style={[styles.customAmountName, { color: colors.text }]} numberOfLines={1}>
                      {name}
                    </Text>
                    <View
                      style={[
                        styles.customAmountInput,
                        {
                          backgroundColor: colors.surfaceHigh,
                          borderColor: errors.customAmounts ? colors.danger : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.customAmountPrefix, { color: colors.primary }]}>$</Text>
                      <TextInput
                        value={customAmounts[name] ?? ''}
                        onChangeText={text => {
                          const cleaned = text.replace(/[^0-9.]/g, '');
                          setCustomAmounts(prev => ({ ...prev, [name]: cleaned }));
                          if (errors.customAmounts) setErrors(prev => ({ ...prev, customAmounts: undefined }));
                        }}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={colors.textSecondary}
                        style={[styles.customAmountField, { color: colors.text }]}
                      />
                    </View>
                  </View>
                ))}
                {errors.customAmounts ? (
                  <Text style={[styles.errorText, { color: colors.danger }]}>{errors.customAmounts}</Text>
                ) : null}
              </View>
            )}
          </View>
        )}

        {/* Note */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            NOTE <Text style={{ fontWeight: '400', textTransform: 'none' }}>(optional)</Text>
          </Text>
          <TextInput
            value={note}
            onChangeText={text => { setNote(text); if (errors.note) setErrors(prev => ({ ...prev, note: undefined })); }}
            placeholder="Any additional context..."
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.textInput,
              styles.noteInput,
              {
                color: colors.text,
                backgroundColor: colors.surfaceHigh,
                borderColor: errors.note ? colors.danger : colors.border,
              },
            ]}
            multiline
            numberOfLines={3}
            maxLength={200}
          />
          <Text style={[styles.charCount, { color: colors.textSecondary }]}>{note.length}/200</Text>
          {errors.note ? <Text style={[styles.errorText, { color: colors.danger }]}>{errors.note}</Text> : null}
        </View>
      </ScrollView>

      <ReceiptButton onPress={openReceipt} bottom={saveBarHeight + Spacing.lg + 64 + Spacing.md} />
      <VoiceMicButton onPress={openVoice} bottom={saveBarHeight + Spacing.lg} />
      <ProgressSheet visible={receipt.busy} label="Reading receipt with Claude…" />
      <VoiceSheet
        visible={voiceOpen}
        listening={voice.listening}
        processing={voiceProcessing}
        transcript={voice.transcript}
        error={voice.error}
        onStop={voice.stop}
        onCancel={closeVoice}
        onRetry={voice.start}
        onTypeSubmit={understand}
      />

      <View
        onLayout={e => setSaveBarHeight(e.nativeEvent.layout.height)}
        style={[
          styles.saveButtonContainer,
          {
            backgroundColor: colors.background,
            paddingBottom: insets.bottom + Spacing.lg,
            borderTopColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.saveButton,
            { backgroundColor: isSaving ? colors.textSecondary : colors.primary },
          ]}
          onPress={handleSave}
          disabled={isSaving}
          activeOpacity={0.85}
        >
          <Text style={styles.saveButtonText}>{isSaving ? 'Saving...' : 'Save Expense'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: { paddingVertical: Spacing.sm, minWidth: 60 },
  headerButtonText: { ...Typography.body },
  headerTitle: { ...Typography.h3 },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.xl },
  field: { marginBottom: Spacing.xl },
  label: {
    ...Typography.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  textInput: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    ...Typography.body,
    height: 52,
  },
  noteInput: { height: 88, textAlignVertical: 'top', paddingTop: Spacing.md },
  dateButton: {
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  dateText: { ...Typography.body },
  splitToggle: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: Spacing.md,
  },
  splitOption: {
    flex: 1,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitOptionText: { ...Typography.body, fontWeight: '600' },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  checkboxLabel: { ...Typography.body },
  splitPreview: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
  },
  splitPreviewText: { ...Typography.body, fontWeight: '500' },
  customAmountsContainer: { gap: Spacing.sm },
  customAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  customAmountName: {
    ...Typography.body,
    flex: 1,
    fontWeight: '500',
  },
  customAmountInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    height: 44,
    minWidth: 110,
  },
  customAmountPrefix: { ...Typography.body, fontWeight: '600', marginRight: 4 },
  customAmountField: { ...Typography.body, flex: 1, paddingVertical: 0 },
  errorText: { ...Typography.caption, marginTop: Spacing.xs, marginLeft: Spacing.xs },
  charCount: { ...Typography.caption, textAlign: 'right', marginTop: Spacing.xs },
  taxInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    height: 52,
  },
  taxPrefix: { ...Typography.body, fontWeight: '600', marginRight: 4 },
  taxField: { ...Typography.body, flex: 1, paddingVertical: 0 },
  taxSplitSection: { marginTop: Spacing.md },
  taxSplitLabel: {
    ...Typography.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  taxToggle: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: Spacing.sm,
  },
  taxOption: {
    flex: 1,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taxOptionText: { ...Typography.body, fontWeight: '600' },
  taxHint: { borderRadius: Radius.md, padding: Spacing.md },
  taxHintText: { ...Typography.caption, fontWeight: '500', textAlign: 'center' },
  saveButtonContainer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveButton: { borderRadius: Radius.lg, height: 54, alignItems: 'center', justifyContent: 'center' },
  saveButtonText: { color: '#FFFFFF', ...Typography.h3 },
});
