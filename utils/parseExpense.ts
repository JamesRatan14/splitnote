import { ParsedExpense, parseExpenseOffline } from './ml';
import { todayISO } from './formatters';

export type ParseSource = 'offline'; // 'llm' is added with the proxy (roadmap step 4)

export interface ParseResult {
  parsed: ParsedExpense;
  source: ParseSource;
}

/**
 * Single entry point for "describe your expense". Today it runs the on-device rule parser;
 * the LLM proxy will slot in here (with schema validation + offline fallback) without
 * changing the Add screen. Async on purpose so callers are already shaped for the network path.
 */
export async function parseExpense(text: string, knownFriends: string[]): Promise<ParseResult> {
  const parsed = parseExpenseOffline(text, { today: todayISO(), knownFriends });
  return { parsed, source: 'offline' };
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
  (p.participants.length > 0 ? filled : missing).push('friends');
  return { filled, missing };
}
