import { useMemo } from 'react';
import type { PaymentMode, Transaction } from '../types';
import {
  AnomalyFlag,
  Category,
  CategoryClassifier,
  CATEGORY_HINT_MIN_CONFIDENCE,
  detectAnomalies,
  FRIEND_SUGGESTION_MIN_HISTORY,
  HistoryItem,
  MAX_FRIEND_SUGGESTIONS,
  MODE_HINT_MIN_CONFIDENCE,
  MODE_HINT_MIN_HISTORY,
  predictPaymentMode,
  recommendParticipants,
} from '../utils/ml';

export interface ExpenseDraft {
  title: string;
  amount: number; // pre-tax subtotal, 0 if not entered yet
  date: string; // YYYY-MM-DD
  mode: PaymentMode;
  participants: string[];
}

export interface ExpenseSuggestions {
  /** Likely friends for this expense, best first (excludes already-added ones). */
  friends: string[];
  /** Category guess for the title, or null when the model is not confident enough. */
  category: Category | null;
  /** Usual payment mode for this kind of expense, only when it differs from the current choice. */
  mode: PaymentMode | null;
  /** Outlier / duplicate warnings for the current amount + title. */
  warnings: AnomalyFlag[];
}

/**
 * On-device model suggestions for the Add screen. Pure computation over the user's own
 * history; nothing here is applied automatically — the screen shows it and the user decides.
 */
export function useExpenseSuggestions(draft: ExpenseDraft, transactions: Transaction[]): ExpenseSuggestions {
  const classifier = useMemo(() => new CategoryClassifier(), []);

  const history: HistoryItem[] = useMemo(
    () =>
      transactions.map(t => ({
        title: t.title,
        amount: t.amount,
        mode: t.mode,
        date: t.date,
        participants: t.participants,
      })),
    [transactions]
  );

  const title = draft.title.trim();
  const participantsKey = draft.participants.join('\u0000');

  const friends = useMemo(() => {
    if (history.length < FRIEND_SUGGESTION_MIN_HISTORY) return [];
    return recommendParticipants(title, draft.date, draft.participants, history, MAX_FRIEND_SUGGESTIONS)
      .filter(r => r.score > 0)
      .map(r => r.name);
    // participantsKey stands in for draft.participants (new array identity every render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, draft.date, participantsKey, history]);

  const category = useMemo(() => {
    if (title.length < 2) return null;
    const p = classifier.predict(title);
    return p.confidence >= CATEGORY_HINT_MIN_CONFIDENCE && p.category !== 'Other' ? p.category : null;
  }, [title, classifier]);

  const predictedMode = useMemo(() => {
    if (title.length < 2) return null;
    const p = predictPaymentMode(title, history, MODE_HINT_MIN_HISTORY);
    return p && p.confidence >= MODE_HINT_MIN_CONFIDENCE ? p.mode : null;
  }, [title, history]);

  const warnings = useMemo(() => {
    if (title.length < 2 || !(draft.amount > 0) || history.length === 0) return [];
    return detectAnomalies({ title, amount: draft.amount, date: draft.date }, history, classifier);
  }, [title, draft.amount, draft.date, history, classifier]);

  return {
    friends,
    category,
    mode: predictedMode && predictedMode !== draft.mode ? predictedMode : null,
    warnings,
  };
}
