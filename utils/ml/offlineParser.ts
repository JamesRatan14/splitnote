import type { PaymentMode } from '../../types';
import { ParsedExpense } from './types';

/**
 * Deterministic, rule-based expense parser. Runs fully offline and serves as
 *  (1) the fallback when the LLM proxy is unreachable, and
 *  (2) the baseline the LLM path is evaluated against (see evals/).
 * Intentionally does NOT handle unequal splits or free-form item lists - that is what the LLM is for.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NAME_STOP = new Set([
  'for', 'at', 'on', 'via', 'using', 'paid', 'tax', 'plus', 'yesterday', 'today', 'last', 'split',
  'by', 'total', 'each', 'in', 'from', 'the', 'including', 'incl', 'it', 'was', 'bill', 'equally',
  'tonight', 'this', 'after', 'before', 'because', 'cause',
]);

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Most recent given weekday; strict=true excludes today. */
function lastWeekday(today: string, weekday: number, strict: boolean): string {
  const t = fromISO(today);
  let diff = (t.getDay() - weekday + 7) % 7;
  if (diff === 0 && strict) diff = 7;
  return addDays(today, -diff);
}

function num(s: string): number {
  return parseFloat(s.replace(/,/g, ''));
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function extractDate(text: string, today: string): { date?: string; rest: string } {
  let m: RegExpMatchArray | null;
  const cut = (mm: RegExpMatchArray) => text.replace(mm[0], ' ');

  if ((m = text.match(/\bday before yesterday\b/i))) return { date: addDays(today, -2), rest: cut(m) };
  if ((m = text.match(/\byesterday\b/i))) return { date: addDays(today, -1), rest: cut(m) };
  if ((m = text.match(/\b(?:today|tonight)\b/i))) return { date: today, rest: cut(m) };
  if ((m = text.match(/\b(\d+)\s+days?\s+ago\b/i))) return { date: addDays(today, -Number(m[1])), rest: cut(m) };

  if ((m = text.match(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i))) {
    return { date: lastWeekday(today, WEEKDAYS.indexOf(m[1].toLowerCase()), true), rest: cut(m) };
  }
  if ((m = text.match(/\b(?:on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i))) {
    return { date: lastWeekday(today, WEEKDAYS.indexOf(m[1].toLowerCase()), false), rest: cut(m) };
  }

  const resolveMD = (month: number, day: number): string => {
    const t = fromISO(today);
    let d = new Date(t.getFullYear(), month, day);
    if (d.getTime() > t.getTime()) d = new Date(t.getFullYear() - 1, month, day);
    return toISO(d);
  };
  if ((m = text.match(/\b(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i))) {
    return { date: resolveMD(MONTHS.indexOf(m[1].toLowerCase()), Number(m[2])), rest: cut(m) };
  }
  if ((m = text.match(/\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i))) {
    return { date: resolveMD(MONTHS.indexOf(m[2].toLowerCase()), Number(m[1])), rest: cut(m) };
  }
  if ((m = text.match(/\b(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const month = Number(m[1]) - 1;
    const day = Number(m[2]);
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      if (m[3]) {
        const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
        return { date: toISO(new Date(y, month, day)), rest: cut(m) };
      }
      return { date: resolveMD(month, day), rest: cut(m) };
    }
  }
  return { rest: text };
}

function extractMode(text: string): { mode?: PaymentMode; rest: string } {
  const re =
    /\b(?:(?:paid|pay|paying|via|using|through|by|on|with|w\/)\s+)?(?:(?:my|the)\s+)?(apple\s*pay|zelle|cash|credit(?:\s*card)?|debit(?:\s*card)?|venmo|paypal|cash\s*app)\b/i;
  const m = text.match(re);
  if (!m) return { rest: text };
  const k = m[1].toLowerCase().replace(/\s+/g, '');
  let mode: PaymentMode = 'Other';
  if (k === 'applepay') mode = 'Apple Pay';
  else if (k === 'zelle') mode = 'Zelle';
  else if (k === 'cash') mode = 'Cash';
  else if (k.startsWith('credit')) mode = 'Credit Card';
  else if (k.startsWith('debit')) mode = 'Debit Card';
  return { mode, rest: text.replace(m[0], ' ') };
}

function extractTax(text: string): { tax?: number; taxPct?: number; includesTax: boolean; rest: string } {
  const includesTax = /\b(?:incl\.?|including|includes|inc)\s+(?:\$?\d+(?:\.\d+)?\s+)?(?:in\s+)?tax/i.test(text);
  let m: RegExpMatchArray | null;
  if ((m = text.match(/\b(\d+(?:\.\d+)?)\s*%\s*(?:sales\s+)?tax\b/i)) || (m = text.match(/\btax\s*(?:of|is|:)?\s*(\d+(?:\.\d+)?)\s*%/i))) {
    return { taxPct: parseFloat(m[1]), includesTax, rest: text.replace(m[0], ' ') };
  }
  if ((m = text.match(/\b(?:sales\s+)?tax(?:es)?\s*(?:of|is|was|:)?\s*\$?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/i))) {
    return { tax: num(m[1]), includesTax, rest: text.replace(m[0], ' ') };
  }
  if ((m = text.match(/\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:in\s+|of\s+)?(?:sales\s+)?tax(?:es)?\b/i))) {
    return { tax: num(m[1]), includesTax, rest: text.replace(m[0], ' ') };
  }
  return { includesTax, rest: text };
}

function extractAmount(text: string): { amount?: number; rest: string } {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/\$\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/))) return { amount: num(m[1]), rest: text.replace(m[0], ' ') };
  if ((m = text.match(/(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:dollars?|bucks|usd)\b/i))) {
    return { amount: num(m[1]), rest: text.replace(m[0], ' ') };
  }
  if ((m = text.match(/\b(\d+(?:\.\d{1,2})?)\b/))) return { amount: num(m[1]), rest: text.replace(m[0], ' ') };
  return { rest: text };
}

function extractParticipants(text: string, known: string[]): { names: string[]; includeMe: boolean; rest: string } {
  const knownMap = new Map(known.map(k => [k.toLowerCase(), k]));
  let includeMe = /\b(?:including|incl\.?|and|&|plus)\s+(?:me|myself)\b|\bme\s+too\b|\bme\s*,/i.test(text);

  const re = /\b(?:split\s+(?:it\s+)?(?:equally\s+)?)?(?:with|between|among|shared with)\s+/gi;
  let last: RegExpExecArray | null = null;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(text))) last = mm;
  if (!last) return { names: [], includeMe, rest: text };

  const start = last.index;
  const after = text.slice(last.index + last[0].length);
  const words = after.split(/\s+/).filter(Boolean);
  const names: string[] = [];
  let consumed = 0;
  let currentParts: string[] = [];
  const flush = () => {
    if (currentParts.length) {
      const joined = currentParts.join(' ');
      const key = joined.toLowerCase();
      if (key === 'me' || key === 'myself') includeMe = true;
      else names.push(knownMap.get(key) ?? joined.split(' ').map(cap).join(' '));
      currentParts = [];
    }
  };
  for (const raw of words) {
    const endsComma = raw.endsWith(',');
    const w = raw.replace(/[,.;]+$/g, '');
    const lw = w.toLowerCase();
    if (lw === 'and' || lw === '&') {
      flush();
      consumed++;
      continue;
    }
    if (!w || NAME_STOP.has(lw) || /\d|\$/.test(w)) break;
    if (currentParts.length >= 2) break;
    currentParts.push(w);
    consumed++;
    if (endsComma) flush();
  }
  flush();

  if (names.length === 0 && !includeMe) return { names: [], includeMe, rest: text };
  const spanEnd = last.index + last[0].length + words.slice(0, consumed).join(' ').length;
  const rest = text.slice(0, start) + ' ' + text.slice(spanEnd);
  return { names: [...new Set(names)], includeMe, rest };
}

function cleanTitle(text: string): string | undefined {
  let t = text
    .replace(/\b(?:including|incl\.?)\s*(?:me|myself)?\b/gi, ' ')
    .replace(/\b(?:i|we)\s+(?:paid|spent|bought|got)\b/gi, ' ')
    .replace(/\b(?:paid|spent|bought|split|total|bill|equally|it|was)\b/gi, ' ')
    .replace(/[$+,;:%]/g, ' ')
    // sentence punctuation left behind by dictation ("Dinner with Sam $84.") — keeps decimals like 9.50
    .replace(/[.!?]+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/^(?:and|plus)\s+|\s+(?:and|plus)$/gi, '').trim();
  t = t.replace(/^(?:on|for|at|the|a|an)\s+/i, '').replace(/\s+(?:on|for|at|the|a|an|by|with|of|in)$/i, '').trim();
  t = t.replace(/^(?:on|for)\s+/i, '').trim();
  return t ? cap(t) : undefined;
}

export interface ParseOptions {
  today: string; // YYYY-MM-DD, injected for determinism
  knownFriends?: string[];
}

export function parseExpenseOffline(input: string, opts: ParseOptions): ParsedExpense {
  const known = opts.knownFriends ?? [];
  let text = ` ${input.trim()} `;

  const d = extractDate(text, opts.today);
  text = d.rest;
  const mo = extractMode(text);
  text = mo.rest;
  const tx = extractTax(text);
  text = tx.rest;
  const am = extractAmount(text);
  text = am.rest;
  const pa = extractParticipants(text, known);
  text = pa.rest;

  let amount = am.amount;
  let tax = tx.tax;
  if (tax === undefined && tx.taxPct !== undefined && amount !== undefined) {
    tax = Math.round(((amount * tx.taxPct) / 100) * 100) / 100;
  }
  if (tx.includesTax && tax !== undefined && amount !== undefined && amount > tax) {
    amount = Math.round((amount - tax) * 100) / 100; // our `amount` is the pre-tax subtotal
  }

  return {
    title: cleanTitle(text),
    amount,
    tax,
    mode: mo.mode,
    date: d.date,
    participants: pa.names,
    includeMe: pa.includeMe,
    splitType: 'equal',
  };
}
