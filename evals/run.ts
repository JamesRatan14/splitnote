/* Eval harness for SplitNote AI components. Run with: npm run eval */
import * as fs from 'fs';
import * as path from 'path';
import { parseExpenseOffline } from '../utils/ml/offlineParser';
import { CategoryClassifier, predictPaymentMode } from '../utils/ml/categoryClassifier';
import { recommendParticipants } from '../utils/ml/participantRecommender';
import { detectAnomalies } from '../utils/ml/anomaly';
import { CATEGORIES, HistoryItem, ParsedExpense } from '../utils/ml/types';
import type { PaymentMode } from '../types';
import { CATEGORY_HINT_MIN_CONFIDENCE, MODE_HINT_MIN_CONFIDENCE } from '../utils/ml/thresholds';

const TODAY = '2026-11-22';
const dataDir = path.join(__dirname, '..', '..', 'evals', 'data');

interface ParseCase {
  input: string;
  expected: Partial<ParsedExpense>;
  tags?: string[];
}

// ---------- tiny seeded PRNG so synthetic data is reproducible ----------
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pct = (x: number) => (x * 100).toFixed(1) + '%';
const lc = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// ---------- 1. Parsing ----------
type Field = 'title' | 'amount' | 'tax' | 'mode' | 'date' | 'participants' | 'includeMe' | 'splitType';
const FIELDS: Field[] = ['title', 'amount', 'tax', 'mode', 'date', 'participants', 'includeMe', 'splitType'];

function fieldOk(f: Field, exp: Partial<ParsedExpense>, got: ParsedExpense): boolean {
  switch (f) {
    case 'title':
      return lc(exp.title ?? '') === lc(got.title ?? '');
    case 'amount':
    case 'tax':
      return Math.abs((exp[f] ?? 0) - (got[f] ?? 0)) < 0.005;
    case 'mode':
    case 'date':
      return (exp[f] ?? null) === (got[f] ?? null);
    case 'participants': {
      const a = (exp.participants ?? []).map(lc).sort().join('|');
      const b = got.participants.map(lc).sort().join('|');
      return a === b;
    }
    case 'includeMe':
      return (exp.includeMe ?? false) === got.includeMe;
    case 'splitType':
      return (exp.splitType ?? 'equal') === got.splitType;
  }
}

function evalParser(
  name: string,
  cases: ParseCase[],
  parse: (s: string) => ParsedExpense
): { fieldAcc: number; exact: number } {
  const per: Record<Field, number> = { title: 0, amount: 0, tax: 0, mode: 0, date: 0, participants: 0, includeMe: 0, splitType: 0 };
  let exact = 0;
  const failures: string[] = [];
  for (const c of cases) {
    const got = parse(c.input);
    let all = true;
    const bad: Field[] = [];
    for (const f of FIELDS) {
      if (fieldOk(f, c.expected, got)) per[f]++;
      else {
        all = false;
        bad.push(f);
      }
    }
    if (all) exact++;
    else failures.push(`  x "${c.input}"  -> wrong: ${bad.join(', ')}`);
  }
  const total = FIELDS.length * cases.length;
  const fieldAcc = Object.values(per).reduce((s, v) => s + v, 0) / total;
  console.log(`\n== Parser: ${name} (n=${cases.length}) ==`);
  console.log(`field-level accuracy: ${pct(fieldAcc)}   exact-match (all fields): ${pct(exact / cases.length)}`);
  console.log('per-field: ' + FIELDS.map(f => `${f} ${pct(per[f] / cases.length)}`).join(' | '));
  if (failures.length) console.log(failures.join('\n'));
  return { fieldAcc, exact: exact / cases.length };
}

// ---------- 2. Category classifier ----------
function evalCategories(): { acc: number; baseline: number; hintCoverage: number; hintAcc: number } {
  const rows: [string, string][] = JSON.parse(fs.readFileSync(path.join(dataDir, 'categories.json'), 'utf8'));
  const clf = new CategoryClassifier();
  const correct: Record<string, number> = {};
  const count: Record<string, number> = {};
  let ok = 0;
  let shown = 0;
  let shownOk = 0;
  const wrong: string[] = [];
  // Baseline: always predict the majority class
  for (const [title, label] of rows) {
    const pred = clf.predict(title);
    const p = pred.category;
    // The Add screen only shows the hint at confidence >= CATEGORY_HINT_MIN_CONFIDENCE
    if (pred.confidence >= CATEGORY_HINT_MIN_CONFIDENCE) {
      shown++;
      if (p === label) shownOk++;
    }
    count[label] = (count[label] ?? 0) + 1;
    if (p === label) {
      ok++;
      correct[label] = (correct[label] ?? 0) + 1;
    } else wrong.push(`  x "${title}": expected ${label}, got ${p}`);
  }
  console.log(`\n== Category classifier (Naive Bayes, held-out n=${rows.length}) ==`);
  console.log(`accuracy: ${pct(ok / rows.length)}   majority-class baseline: ${pct(Math.max(...Object.values(count)) / rows.length)}`);
  console.log('per-class: ' + CATEGORIES.filter(c => count[c]).map(c => `${c} ${pct((correct[c] ?? 0) / count[c])}`).join(' | '));
  console.log(
    `UI hint (confidence >= ${CATEGORY_HINT_MIN_CONFIDENCE}): shown on ${pct(shown / rows.length)} of titles, ` +
      `accuracy when shown ${pct(shownOk / Math.max(shown, 1))}`
  );
  if (wrong.length) console.log(wrong.join('\n'));
  const baseline = Math.max(...Object.values(count)) / rows.length;
  return { acc: ok / rows.length, baseline, hintCoverage: shown / rows.length, hintAcc: shownOk / Math.max(shown, 1) };
}

// ---------- synthetic user history (clearly synthetic; used for 3 + 4 + 5) ----------
const FRIENDS = ['Rahul', 'Priya', 'Sam', 'Alex', 'Maya', 'Chen', 'Jo', 'Omar'];
interface Habit { titles: string[]; friends: string[]; dow: number; mode: PaymentMode; mean: number }
const HABITS: Habit[] = [
  { titles: ['Dinner at Dominos', 'Pizza night', 'Dinner out'], friends: ['Rahul', 'Priya', 'Sam'], dow: 5, mode: 'Zelle', mean: 55 },
  { titles: ['Wegmans groceries', 'Weekly grocery run', 'Costco run'], friends: ['Maya', 'Chen'], dow: 0, mode: 'Credit Card', mean: 90 },
  { titles: ['Uber ride', 'Lyft home', 'Uber to airport'], friends: ['Alex', 'Omar'], dow: 6, mode: 'Apple Pay', mean: 24 },
  { titles: ['Movie tickets', 'Bowling night', 'Concert tickets'], friends: ['Jo', 'Sam', 'Alex'], dow: 6, mode: 'Debit Card', mean: 40 },
];

function genHistory(n: number, seed: number): HistoryItem[] {
  const rnd = mulberry32(seed);
  const out: HistoryItem[] = [];
  for (let i = 0; i < n; i++) {
    const h = HABITS[Math.floor(rnd() * HABITS.length)];
    const base = new Date(2026, 4, 1);
    base.setDate(base.getDate() + Math.floor(i * (200 / n)));
    while (base.getDay() !== h.dow) base.setDate(base.getDate() + 1);
    const date = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
    // each habit's core friends show up with p=0.8, plus a 15% chance of a random friend
    const parts = h.friends.filter(() => rnd() < 0.8);
    if (rnd() < 0.15) parts.push(FRIENDS[Math.floor(rnd() * FRIENDS.length)]);
    const uniq = [...new Set(parts)];
    if (uniq.length === 0) uniq.push(h.friends[0]);
    out.push({
      title: h.titles[Math.floor(rnd() * h.titles.length)],
      amount: Math.max(5, Math.round((h.mean * (0.75 + rnd() * 0.5)) * 100) / 100),
      mode: rnd() < 0.9 ? h.mode : 'Cash',
      date,
      participants: uniq,
    });
  }
  return out;
}

// ---------- 3. Participant recommender (leave-last-out vs frequency baseline) ----------
function evalRecommender(): { model: number; baseline: number } {
  const hist = genHistory(150, 7);
  let hitModel = 0;
  let hitBase = 0;
  let trials = 0;
  for (let i = 30; i < hist.length; i++) {
    const target = hist[i];
    const past = hist.slice(0, i);
    // reveal one participant, ask the model for the rest
    const revealed = [target.participants[0]];
    const truth = target.participants.slice(1);
    if (truth.length === 0) continue;
    trials++;
    const recs = recommendParticipants(target.title, target.date, revealed, past, 3).map(r => r.name.toLowerCase());
    const freq = new Map<string, number>();
    past.forEach(p => p.participants.forEach(n => freq.set(n, (freq.get(n) ?? 0) + 1)));
    const base = [...freq.entries()].filter(([n]) => n !== revealed[0]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n.toLowerCase());
    // hit@3 = fraction of true remaining participants that appear in the top-3
    const frac = (list: string[]) => truth.filter(t => list.includes(t.toLowerCase())).length / truth.length;
    hitModel += frac(recs);
    hitBase += frac(base);
  }
  console.log(`\n== Participant recommender (synthetic history, ${trials} trials) ==`);
  console.log(`recall@3: model ${pct(hitModel / trials)}  vs  global-frequency baseline ${pct(hitBase / trials)}`);
  return { model: hitModel / trials, baseline: hitBase / trials };
}

// ---------- 4. Payment-mode predictor ----------
function evalMode(): { acc: number; baseline: number; hintCoverage: number; hintAcc: number } {
  const hist = genHistory(200, 11);
  const split = 120;
  const train = hist.slice(0, split);
  let ok = 0;
  let base = 0;
  let shown = 0;
  let shownOk = 0;
  const modeCount = new Map<string, number>();
  train.forEach(t => modeCount.set(t.mode, (modeCount.get(t.mode) ?? 0) + 1));
  const majority = [...modeCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
  for (const t of hist.slice(split)) {
    const p = predictPaymentMode(t.title, train);
    if (p && p.mode === t.mode) ok++;
    if (p && p.confidence >= MODE_HINT_MIN_CONFIDENCE) {
      shown++;
      if (p.mode === t.mode) shownOk++;
    }
    if (majority === t.mode) base++;
  }
  const n = hist.length - split;
  console.log(`\n== Payment-mode predictor (synthetic, n=${n}) ==`);
  console.log(`accuracy: ${pct(ok / n)}   majority-mode baseline: ${pct(base / n)}`);
  console.log(
    `UI hint (confidence >= ${MODE_HINT_MIN_CONFIDENCE}): shown on ${pct(shown / n)}, accuracy when shown ${pct(shownOk / Math.max(shown, 1))}`
  );
  return { acc: ok / n, baseline: base / n, hintCoverage: shown / n, hintAcc: shownOk / Math.max(shown, 1) };
}

// ---------- 5. Anomaly detection (injected outliers) ----------
function evalAnomaly(): { precision: number; recall: number; duplicateOk: boolean } {
  const hist = genHistory(120, 3);
  const clf = new CategoryClassifier();
  const rnd = mulberry32(99);
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let tn = 0;
  for (let i = 0; i < 100; i++) {
    const h = hist[Math.floor(rnd() * hist.length)];
    const injected = i % 2 === 0;
    const cand = { title: h.title, date: '2026-11-22', amount: injected ? Math.round(h.amount * (4 + rnd() * 4)) : Math.round(h.amount * (0.8 + rnd() * 0.4)) };
    const flagged = detectAnomalies(cand, hist, clf).some(f => f.kind === 'outlier');
    if (injected) flagged ? tp++ : fn++;
    else flagged ? fp++ : tn++;
  }
  const prec = tp / Math.max(tp + fp, 1);
  const rec = tp / Math.max(tp + fn, 1);
  console.log(`\n== Outlier detector (median/MAD, 50 injected 4-8x outliers + 50 normal) ==`);
  console.log(`precision ${pct(prec)}  recall ${pct(rec)}  false-positive rate ${pct(fp / Math.max(fp + tn, 1))}`);

  const dup = detectAnomalies(
    { title: 'Dinner at Dominos', amount: hist[0].amount, date: hist[0].date },
    [{ ...hist[0], title: 'Dinner at Dominos' }],
    clf
  ).some(f => f.kind === 'duplicate');
  console.log(`duplicate detection sanity check: ${dup ? 'PASS' : 'FAIL'}`);
  return { precision: prec, recall: rec, duplicateOk: dup };
}

// ---------- run ----------
const cases: ParseCase[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'parse_cases.json'), 'utf8'));
const offline = (s: string) => parseExpenseOffline(s, { today: TODAY });
const parseAll = evalParser('offline rules, all cases', cases, offline);
const parseEasy = evalParser('offline rules, non-hard cases only', cases.filter(c => !c.tags?.includes('hard')), offline);
const cat = evalCategories();
const rec = evalRecommender();
const mode = evalMode();
const anom = evalAnomaly();

// ---------- regression gates (CI fails if any drops below its floor) ----------
// Floors sit a few points under current scores: they catch regressions, they are not claims of real-world accuracy.
interface Gate { name: string; value: number; min: number }
const gates: Gate[] = [
  { name: 'parser field-level (all cases)', value: parseAll.fieldAcc, min: 0.9 },
  { name: 'parser exact-match (non-hard)', value: parseEasy.exact, min: 0.95 },
  { name: 'category accuracy (held-out)', value: cat.acc, min: 0.85 },
  { name: 'category hint accuracy when shown', value: cat.hintAcc, min: 0.9 },
  { name: 'recommender recall@3 (synthetic)', value: rec.model, min: 0.85 },
  { name: 'recommender lift over baseline', value: rec.model - rec.baseline, min: 0.1 },
  { name: 'mode accuracy (synthetic)', value: mode.acc, min: 0.8 },
  { name: 'mode hint accuracy when shown (synth.)', value: mode.hintAcc, min: 0.85 },
  { name: 'outlier precision (synthetic)', value: anom.precision, min: 0.9 },
  { name: 'outlier recall (synthetic)', value: anom.recall, min: 0.9 },
  { name: 'duplicate detection', value: anom.duplicateOk ? 1 : 0, min: 1 },
];
console.log('\n== Regression gates ==');
let failed = 0;
for (const g of gates) {
  const ok = g.value >= g.min;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${g.name.padEnd(40)} ${pct(g.value).padStart(7)}  (min ${pct(g.min)})`);
}
console.log('\n(LLM-proxy parser will be added as another system in evalParser in the proxy step.)');
if (failed) {
  console.error(`\n${failed} eval gate(s) failed.`);
  process.exitCode = 1;
}
