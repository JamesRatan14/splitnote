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

const RELATION_WORDS = new Set([
  'my', 'our', 'friend', 'friends', 'roommate', 'roommates', 'buddy', 'buddies', 'coworker', 'coworkers',
  'colleague', 'colleagues', 'brother', 'sister', 'cousin', 'cousins', 'mate', 'mates',
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
    // "with my friend D", "with my roommates Ana and Ben": skip the relation words, keep the names
    if (currentParts.length === 0 && RELATION_WORDS.has(lw)) {
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

// ---------- natural-speech fallbacks (used when the "with X and Y" pattern finds nobody) ----------

const NOT_A_NAME = new Set([
  'i', 'me', 'my', 'we', 'us', 'the', 'a', 'an', 'and', 'or', 'it', 'he', 'she', 'they', 'his', 'her', 'their',
  'so', 'then', 'paid', 'pay', 'split', 'total', 'dinner', 'lunch', 'breakfast', 'coffee', 'uber', 'lyft', 'zelle',
  'cash', 'apple', 'venmo', 'movie', 'movies', 'groceries', 'today', 'yesterday', 'tonight', 'went', 'got',
]);
const RELATION = '(?:friend|friends|roommate|roommates|buddy|coworker|colleague|brother|sister|cousin|mate)';

/**
 * Picks up friends from natural phrasing the main extractor misses:
 * "me and Maya", "Priya and me", "Josh and I", "his name is D", "my friend Josh", or a known friend mentioned anywhere.
 */
function extractLooseParticipants(
  text: string,
  known: string[]
): { names: string[]; includeMe: boolean; rest: string } {
  const knownMap = new Map(known.map(k => [k.toLowerCase(), k]));
  const names: string[] = [];
  let rest = text;
  const add = (raw: string) => {
    const w = raw.replace(/[,.;!?]+$/g, '').trim();
    if (!w || NOT_A_NAME.has(w.toLowerCase()) || /\d|\$/.test(w)) return;
    const name = knownMap.get(w.toLowerCase()) ?? w.split(' ').map(cap).join(' ');
    if (!names.some(n => n.toLowerCase() === name.toLowerCase())) names.push(name);
  };
  const take = (re: RegExp, group = 1) => {
    rest = rest.replace(re, (...m: string[]) => {
      add(m[group]);
      return ' ';
    });
  };

  // "his name is D", "their names are Sam and Alex"
  rest = rest.replace(
    /\b(?:his|her|their|(?:my\s+)?friends?'?s?)\s+names?\s+(?:is|are|was|were)\s+([\w'-]+(?:\s*(?:,|and|&)\s*[\w'-]+)*)/gi,
    (_m: string, list: string) => {
      list.split(/\s*(?:,|\band\b|&)\s*/i).forEach(add);
      return ' ';
    }
  );
  take(new RegExp(`\\b[Mm]y\\s+${RELATION}\\s+([A-Z][\\w'-]*)`, 'g')); // "my friend Josh"
  take(/\b(?:me|myself)\s+and\s+([A-Z][\w'-]*)/g); // "me and Maya"
  take(/\b([A-Z][\w'-]*)\s+and\s+(?:me|myself|I)\b/g); // "Priya and me", "Josh and I"

  // a known friend mentioned anywhere ("... for Rahul")
  for (const k of known) {
    const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(rest)) {
      add(k);
      rest = rest.replace(re, ' ');
    }
  }

  const includeMe =
    /\b(?:includ(?:es|ing|ed)\s+me|both\s+of\s+us|all\s+of\s+us|\d+\s+of\s+us|(?:between|among|on)\s+(?:the\s+)?(?:both\s+of\s+)?us|for\s+(?:me|us)\b|me\s+and\b|and\s+(?:me|myself|I)\b|(?:split|share)\s+(?:it\s+)?with\s+me)/i.test(
      text
    );
  return { names, includeMe, rest };
}

/** Turns a long spoken sentence into a short title: drops filler, cuts at clause words, "X at Place" → "X - Place". */
function simplifyTitle(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  let t = ` ${raw} `;
  t = t
    .replace(new RegExp(`\\b(?:my\\s+${RELATION}\\s+(?:and\\s+I\\s+)?|we\\s+)(?:went|had|did|got)?\\s*(?:to\\s+)?`, 'gi'), ' ')
    .replace(/\b(?:i|we)\s+(?:have\s+|had\s+|just\s+)?(?:paid|got|bought|spent|covered|had)?\s*(?:for\s+)?/gi, ' ')
    .replace(/^\s*(?:and\s+)?(?:got|bought|grabbed|went|go|going)\s+(?:to\s+)?(?:the\s+)?/i, ' ');
  // cut at the first clause marker: the rest is explanation, not a title
  const cut = t.search(
    /\s(?:which|that|so|because|since|cause|and\s+(?:his|her|their|my|i|we)|split|share|for\s+(?:me|us|the\s+(?:both|two|three|four))|includes?|including|to\s+share|was|were|with|me\s+and)\b/i
  );
  if (cut > 1) t = t.slice(0, cut);
  t = t.replace(/\s+(?:for|to|on|of|and|the|a|an)\s*$/i, '').replace(/^\s*(?:a|an|the)\s+/i, '');
  t = t.replace(/\s+/g, ' ').trim();
  // "Dinner at Olive Garden" → "Dinner - Olive Garden" (place names are capitalised by speech-to-text)
  const at = t.match(/^(.+?)\s+at\s+([A-Z][\w'&-]*(?:\s+[A-Z][\w'&-]*)*)$/);
  if (at) t = `${at[1]} - ${at[2]}`;
  const words = t.split(' ');
  if (words.length > 6) t = words.slice(0, 6).join(' ');
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
  let pa = extractParticipants(text, known);
  text = pa.rest;
  if (pa.names.length === 0) {
    const loose = extractLooseParticipants(text, known);
    pa = { names: loose.names, includeMe: pa.includeMe || loose.includeMe, rest: loose.rest };
    text = loose.rest;
  }

  let amount = am.amount;
  let tax = tx.tax;
  if (tax === undefined && tx.taxPct !== undefined && amount !== undefined) {
    tax = Math.round(((amount * tx.taxPct) / 100) * 100) / 100;
  }
  if (tx.includesTax && tax !== undefined && amount !== undefined && amount > tax) {
    amount = Math.round((amount - tax) * 100) / 100; // our `amount` is the pre-tax subtotal
  }

  return {
    title: simplifyTitle(cleanTitle(text)),
    amount,
    tax,
    mode: mo.mode,
    date: d.date,
    participants: pa.names,
    includeMe: pa.includeMe,
    splitType: 'equal',
  };
}
