import type { PaymentMode } from '../../types';
import { CATEGORIES, Category, ParsedExpense } from '../ml/types';

/**
 * Validates an AI-proxy response before it can touch the form. The server already range-checks,
 * but the app never trusts a network payload: unknown or out-of-range values are dropped, not fixed.
 * Pure function (no React / RN) so it can be checked in evals.
 */

const MODES: PaymentMode[] = ['Cash', 'Credit Card', 'Debit Card', 'Zelle', 'Apple Pay', 'Other'];
const NOT_NAMES = new Set(['me', 'i', 'myself', 'you', 'us', 'we', 'my friend', 'friend', 'friends']);
const MAX_AMOUNT = 1_000_000;

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function money(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= MAX_AMOUNT ? Math.round(x * 100) / 100 : undefined;
}

function isoDate(x: unknown): string | undefined {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return undefined;
  const d = new Date(x + 'T00:00:00');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== x ? undefined : x;
}

function cleanName(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined;
  const n = x.replace(/\s+/g, ' ').trim().slice(0, 40);
  return n && !NOT_NAMES.has(n.toLowerCase()) ? n : undefined;
}

export function validateAiExpense(payload: unknown): ParsedExpense | null {
  if (!isObj(payload) || !isObj(payload.expense)) return null;
  const e = payload.expense;

  const title = typeof e.title === 'string' ? e.title.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined : undefined;
  const amount = money(e.amount);
  let tax = money(e.tax);
  if (tax !== undefined && amount !== undefined && tax >= amount) tax = undefined;
  const mode = typeof e.mode === 'string' && (MODES as string[]).includes(e.mode) ? (e.mode as PaymentMode) : undefined;
  const category =
    typeof e.category === 'string' && (CATEGORIES as string[]).includes(e.category) ? (e.category as Category) : undefined;

  const participants: string[] = [];
  if (Array.isArray(e.participants)) {
    for (const raw of e.participants) {
      const n = cleanName(raw);
      if (n && !participants.some(p => p.toLowerCase() === n.toLowerCase())) participants.push(n);
      if (participants.length >= 20) break;
    }
  }

  let splitType: ParsedExpense['splitType'] = 'equal';
  let customAmounts: Record<string, number> | undefined;
  if (e.splitType === 'custom' && isObj(e.customAmounts) && participants.length > 0) {
    const shares: Record<string, number> = {};
    for (const p of participants) {
      const v = money((e.customAmounts as Record<string, unknown>)[p]);
      if (v === undefined) break;
      shares[p] = v;
    }
    const total = Object.values(shares).reduce((s, v) => s + v, 0);
    if (Object.keys(shares).length === participants.length && (amount === undefined || total <= amount + 0.01)) {
      splitType = 'custom';
      customAmounts = shares;
    }
  }

  const note = typeof e.note === 'string' ? e.note.trim().slice(0, 200) || undefined : undefined;

  return {
    title,
    amount,
    tax,
    mode,
    date: isoDate(e.date),
    participants,
    includeMe: e.includeMe === true,
    splitType,
    customAmounts,
    note,
    category,
  };
}

export interface AiMeta {
  model: string;
  latencyMs: number;
  costUsd: number;
  /** Server warning codes, e.g. "not_an_expense", "other_currency:INR". */
  warnings: string[];
}

export function readMeta(payload: unknown): AiMeta | null {
  if (!isObj(payload) || !isObj(payload.meta)) return null;
  const m = payload.meta;
  return {
    model: typeof m.model === 'string' ? m.model : 'unknown',
    latencyMs: typeof m.latencyMs === 'number' ? m.latencyMs : 0,
    costUsd: typeof m.costUsd === 'number' ? m.costUsd : 0,
    warnings: Array.isArray(m.warnings)
      ? m.warnings.filter((w): w is string => typeof w === 'string').slice(0, 10)
      : [],
  };
}
