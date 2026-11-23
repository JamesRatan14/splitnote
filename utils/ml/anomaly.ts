import { HistoryItem } from './types';
import { CategoryClassifier } from './categoryClassifier';
import { jaccard, tokenize } from './tokenize';
import { formatCurrency, formatDate } from '../formatters';

export interface AnomalyFlag {
  kind: 'outlier' | 'duplicate';
  message: string;
  score: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Robust z-score using median / MAD (resistant to the outliers it is trying to find). */
export function robustZ(value: number, sample: number[]): number {
  const med = median(sample);
  const mad = median(sample.map(x => Math.abs(x - med)));
  const scale = 1.4826 * (mad || Math.max(med * 0.25, 1)); // fall back if MAD == 0
  return (value - med) / scale;
}

export interface NewExpense {
  title: string;
  amount: number;
  date: string;
}

/**
 * Flags (a) amounts far outside the user's usual range for that category and
 * (b) likely duplicates (same amount, similar title, within 2 days).
 */
export function detectAnomalies(
  candidate: NewExpense,
  history: HistoryItem[],
  classifier: CategoryClassifier,
  opts: { zThreshold?: number; minSample?: number } = {}
): AnomalyFlag[] {
  const zThreshold = opts.zThreshold ?? 3.5;
  const minSample = opts.minSample ?? 5;
  const flags: AnomalyFlag[] = [];

  const cat = classifier.predict(candidate.title).category;
  const sameCat = history.filter(h => classifier.predict(h.title).category === cat).map(h => h.amount);
  const sample = sameCat.length >= minSample ? sameCat : history.map(h => h.amount);
  if (sample.length >= minSample) {
    const z = robustZ(candidate.amount, sample);
    if (z > zThreshold) {
      flags.push({
        kind: 'outlier',
        score: z,
        message: `Unusually high for ${sameCat.length >= minSample ? cat : 'your expenses'} (median ${formatCurrency(median(sample))})`,
      });
    }
  }

  const toks = tokenize(candidate.title);
  const cDate = new Date(candidate.date + 'T00:00:00').getTime();
  for (const h of history) {
    const dd = Math.abs(new Date(h.date + 'T00:00:00').getTime() - cDate) / 86_400_000;
    if (dd <= 2 && Math.abs(h.amount - candidate.amount) < 0.005 && jaccard(toks, tokenize(h.title)) >= 0.5) {
      flags.push({ kind: 'duplicate', score: 1, message: `Looks like a duplicate of "${h.title}" on ${formatDate(h.date)}` });
      break;
    }
  }
  return flags;
}
