import { HistoryItem } from './types';
import { jaccard, tokenize } from './tokenize';

export interface Recommendation {
  name: string;
  score: number;
}

const HALF_LIFE_DAYS = 45;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a + 'T00:00:00').getTime() - new Date(b + 'T00:00:00').getTime()) / 86_400_000;
}

/**
 * Ranks likely participants for a new expense. Score per friend is the sum, over past
 * transactions they were in, of: recency decay x (title similarity + co-occurrence with
 * already-selected friends + weekday match). Cheap, explainable, runs on-device.
 */
export function recommendParticipants(
  title: string,
  date: string,
  selected: string[],
  history: HistoryItem[],
  topK = 5
): Recommendation[] {
  const titleToks = tokenize(title);
  const selectedLower = new Set(selected.map(s => s.toLowerCase()));
  const dow = new Date(date + 'T00:00:00').getDay();
  const scores = new Map<string, { name: string; score: number }>();

  for (const h of history) {
    const decay = Math.pow(0.5, daysBetween(date, h.date) / HALF_LIFE_DAYS);
    const sim = titleToks.length ? jaccard(titleToks, tokenize(h.title)) : 0;
    const hl = h.participants.map(p => p.toLowerCase());
    const coocc = selectedLower.size
      ? [...selectedLower].filter(s => hl.includes(s)).length / selectedLower.size
      : 0;
    const sameDow = new Date(h.date + 'T00:00:00').getDay() === dow ? 1 : 0;
    const weight = decay * (0.2 + 1.0 * sim + 1.5 * coocc + 0.3 * sameDow);

    for (const p of h.participants) {
      if (selectedLower.has(p.toLowerCase())) continue;
      const key = p.toLowerCase();
      const cur = scores.get(key) ?? { name: p, score: 0 };
      cur.score += weight;
      scores.set(key, cur);
    }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}
