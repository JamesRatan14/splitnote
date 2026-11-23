import { ParsedExpense, parseExpenseOffline } from './ml';
import { todayISO } from './formatters';
import { AiError, AiSettings, aiParseExpense, isAiReady } from './ai/client';

export type ParseSource = 'llm' | 'offline';

export interface ParseResult {
  parsed: ParsedExpense;
  source: ParseSource;
  /** Set when the LLM path was skipped or failed and we fell back to the offline parser. */
  fallbackReason?: string;
  latencyMs?: number;
  model?: string;
}

/**
 * Single entry point for voice / typed descriptions.
 * Claude (via the SplitNote proxy) first; on any failure — not set up, offline, timeout, refusal,
 * invalid response — the on-device rule parser fills in. The caller shows which one answered.
 */
export async function parseExpense(text: string, knownFriends: string[], ai?: AiSettings | null): Promise<ParseResult> {
  const today = todayISO();
  if (isAiReady(ai)) {
    try {
      const { parsed, meta } = await aiParseExpense(ai, text, today, knownFriends);
      return { parsed, source: 'llm', latencyMs: meta?.latencyMs, model: meta?.model };
    } catch (e) {
      const reason = e instanceof AiError ? e.message : 'AI unavailable';
      return { parsed: parseExpenseOffline(text, { today, knownFriends }), source: 'offline', fallbackReason: reason };
    }
  }
  return {
    parsed: parseExpenseOffline(text, { today, knownFriends }),
    source: 'offline',
    fallbackReason: 'AI not set up (Settings)',
  };
}

/** Human-readable list of which form fields a parse filled, for the confirmation line. */
export function describeFilled(p: ParsedExpense): { filled: string[]; missing: string[] } {
  const filled: string[] = [];
  const missing: string[] = [];
  (p.title ? filled : missing).push('title');
  (p.amount !== undefined && p.amount > 0 ? filled : missing).push('amount');
  if (p.tax !== undefined && p.tax > 0) filled.push('tax');
  if (p.mode) filled.push('payment');
  if (p.date) filled.push('date');
  if (p.participants.length > 0) filled.push(p.splitType === 'custom' ? 'friends + split' : 'friends');
  else missing.push('friends');
  if (p.note) filled.push('note');
  return { filled, missing };
}
