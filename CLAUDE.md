# CLAUDE.md — SplitNote

> Context file for Claude Code. Read fully before changing code. This is the single source of truth;
> `AGENTS.md` only points here (the old ₹/UPI/SDK-51 spec is obsolete).
> Working copy: `Expenz_1`. The original `Expenz` folder is a reference snapshot — do not edit it.

---

## 1. What this project is

A personal, single-user app to log group expenses in seconds, then batch-enter them into Splitwise on weekends.
Name is **SplitNote** everywhere (display name, package, slug, bundle id `com.personal.splitnote`).

**Second goal (important):** the project is also the owner's AI/ML portfolio piece for job applications
(AI/ML + SWE roles). Every AI feature must therefore be **measurable** (evals), **honest** (no inflated numbers),
**safe** (no secrets in the client, validated model output) and **deployed** (live URL + CI).

Core flow: `pay for group → open app → log (title, amount, tax, mode, friends, date) → [weekend] → enter in Splitwise → mark synced`.

---

## 2. Status

| Area | State |
|---|---|
| MVP logbook (add / list / detail / mark synced / delete / backup) | Done |
| Custom splits, tax splitting (equal / proportional / custom), USD formatting | Done |
| On-device ML in `utils/ml/` + eval harness with CI regression gates | Done |
| ML suggestions on the Add screen (friends, category, mode, outlier/duplicate) | Done (browser-tested) |
| Web/PWA build; web-safe confirm dialogs | Done, **live** at https://jamesratan14.github.io/splitnote/ |
| Voice entry: floating mic → listening sheet → fills the form | Done (offline parser; browser-tested with a mocked recogniser — **real-device test pending**); LLM upgrade in step 4 |
| Native iOS build for SideStore (`ios-sideload.yml`) | Workflow written + prebuild verified locally; **first CI run pending** |
| Claude path: FastAPI proxy (`server/`) → voice parsing + receipt reading, app-side validation, offline fallback | Built + tested with a fake Claude (20 server tests, browser e2e); **not deployed — needs the owner's Vercel + Anthropic accounts** |
| Receipt scan (camera button on Add screen → Claude vision) | Built (same status as above) |
| LLM eval vs offline (`server/evals/eval_llm.py`) | Built; **not run yet** (costs ~$0.70; needs the key) |
| Eval on the owner's real expenses; README with metrics + demo GIF | Planned |

---

## 3. Tech stack (actual)

| Layer | Choice |
|---|---|
| Framework | Expo SDK **54**, React Native 0.81, React 19.1, TypeScript (strict) |
| Navigation | Expo Router 6 (file-based) |
| Storage | AsyncStorage (localStorage on web), accessed only via `utils/storage.ts` + hooks |
| Web | `react-native-web`, `react-dom`, `@expo/metro-runtime`; Metro bundler, `output: "single"` (SPA) |
| Native-only modules | `expo-haptics` (no-op on web), `expo-notifications`, `expo-file-system`, `expo-sharing`, `@react-native-community/datetimepicker` |
| AI (on-device) | Pure TypeScript in `utils/ml/` — runs on native and web |
| AI (cloud) | `server/`: FastAPI on **Vercel** (serverless Python) → `anthropic` 2.x `beta.messages.parse` with Pydantic structured output; default `claude-opus-5-5`, effort `low`, refusal `fallbacks: "default"`; key lives only on the server |
| CI/CD | GitHub Actions: web → GitHub Pages (Linux); iOS `.ipa` → GitHub Release (macOS) |

Keep dependencies on SDK-54-compatible versions: run `npx expo install --check` after adding packages
(e.g. `react-native-worklets` must stay `0.5.x` for Reanimated 4.1 — a mismatch breaks the native build).

### How the app is delivered
1. **Web app / PWA on the iPhone home screen (primary).** Free, never expires. Repo is **public**, so the URL is
   `https://<owner>.github.io/splitnote/`. Home-screen web apps are exempt from Safari's 7-day storage cap.
2. **Native iOS via SideStore (secondary).** `.github/workflows/ios-sideload.yml` (manual or on `v*` tag) builds an
   **unsigned** `.ipa` on macOS, publishes it as a GitHub Release along with `source.json`. SideStore signs it on the
   phone with a **secondary** Apple ID (free account: 7-day signing, refreshed by SideStore on-device; max 3 apps).
   SideStore source URL: `https://github.com/<owner>/splitnote/releases/latest/download/source.json`.
   The push entitlement (`aps-environment`, added by `expo-notifications`) is stripped in CI — free accounts can't sign it; local notifications still work.
3. **Expo Go** only if the App Store Expo Go still supports SDK 54 (probably not). Don't rely on it.

**Web and native data are separate stores.** Move data with Settings → Export / Import.

---

## 4. Data model (source of truth: `types/index.ts`)

```ts
type PaymentMode = 'Cash' | 'Credit Card' | 'Debit Card' | 'Zelle' | 'Apple Pay' | 'Other';
type SyncStatus = 'pending' | 'synced';
type SplitType = 'equal' | 'custom';
type TaxSplitType = 'equal' | 'proportional' | 'custom';

interface Transaction {
  id: string;
  title: string;
  amount: number;            // PRE-TAX subtotal paid by the user (USD)
  tax?: number;              // tax is stored separately; total = amount + tax
  mode: PaymentMode;
  date: string;              // 'YYYY-MM-DD'
  participants: string[];    // friends only (never the user)
  includeMe: boolean;        // does the payer share the cost? (form default: false)
  splitType: SplitType;
  customAmounts?: Record<string, number>;
  taxSplitType?: TaxSplitType;
  customTaxAmounts?: Record<string, number>;
  note?: string;
  syncStatus: SyncStatus;
  createdAt: string;         // ISO timestamp
}
```

Storage keys: `@splitnote/transactions_v1`, `@splitnote/known_friends_v1`. Always parse defensively (corrupt JSON must not crash).
Do **not** change key names or rename fields without a migration — it would orphan the user's data.

`useTransactions` mutations go through `mutate()`, which re-reads storage before applying the change, so a screen
holding a stale copy can't overwrite newer data. Keep it that way for any new mutation (e.g. edit).

Split math lives only in `utils/calculations.ts` (`calculateSplit`, `getPersonBreakdown`, `getTotalToCollect`, `getOwedByFriend`).
Rounding is to 2 dp per person; accept small rounding loss, never redistribute.

---

## 5. AI architecture

### 5.1 On-device models — `utils/ml/`
| File | Purpose |
|---|---|
| `naiveBayes.ts`, `tokenize.ts` | Multinomial Naive Bayes (Laplace smoothing), tokenizer, Jaccard |
| `categoryClassifier.ts` | `CategoryClassifier` (seeded cold-start corpus + `learn()` for personalisation); `predictPaymentMode()` learned from the user's history (needs ≥10 items) |
| `participantRecommender.ts` | `recommendParticipants()` — recency-decayed score from title similarity, co-occurrence, weekday |
| `anomaly.ts` | `detectAnomalies()` — median/MAD robust z-score outliers per category + duplicate detection |
| `offlineParser.ts` | `parseExpenseOffline(text, {today, knownFriends})` — rule-based natural-language parser. **Cannot** do unequal splits or free-form phrasing — that is the LLM's job |
| `thresholds.ts` | Confidence gates for showing hints — **shared by the UI and `evals/run.ts`** |
| `types.ts`, `index.ts` | `ParsedExpense`, `HistoryItem`, `Category`; barrel export |

Rules: no `any`; no network; no AsyncStorage access inside `utils/ml/` (callers pass history in); deterministic (inject `today`).
Pure helpers from `utils/formatters.ts` are allowed.

**In the UI:** `hooks/useExpenseSuggestions.ts` turns the draft + history into suggestions; `components/SmartHints.tsx`
renders them on the Add screen (`CategoryHint`, `AnomalyWarnings`, `ModeHint`, `FriendSuggestions`).
Suggestions are **never applied without a tap**; warnings never block saving.
**Voice entry** (Add screen): floating mic (`components/VoiceCapture.tsx` → `VoiceMicButton`) opens `VoiceSheet`
(pulsing mic, live transcript, Done/Cancel); `hooks/useVoiceInput.ts` wraps `expo-speech-recognition@~3.1.3`
(the SDK-54 line — newer majors track SDK 56+). Native = iOS SFSpeechRecognizer (Info.plist strings via the config plugin
in `app.json`; friends' names passed as `contextualStrings`); web = the browser's `SpeechRecognition`.
**On web `start()` must run synchronously inside the tap** (Safari's user-gesture rule) — don't put an `await` before it.
On end, the transcript → `utils/parseExpense.ts` `parseExpense()` → fills only the fields it found (participants replaced,
others overwritten) → `VoiceResultBanner` shows "Filled …" + "Heard: …". Nothing saves without the user tapping Save.
`parseExpense()` is the single plug-in point for the LLM proxy (keep it async; return `source`).
Spoken/dictated text capitalises, writes "$84" or "84 dollars", and may end with "." — the parser strips stray sentence
punctuation; `"tags":["dictation"]` cases cover this. Home-screen web apps on older iOS versions have had flaky
SpeechRecognition support — if it fails on the owner's phone, the SideStore native build is the fallback.
The category hint is display-only (category is not stored yet — storing it would be an optional `category?` field).

### 5.2 LLM path — `server/` + `utils/ai/` (built; deploy steps in `server/README.md`)
- **Server** (`server/splitnote_ai/`): `main.py` (FastAPI routes, passphrase auth via `X-SplitNote-Key` + `hmac.compare_digest`,
  CORS allow-list, 6.5 MB body cap, content-free logs), `claude.py` (Claude calls + `sanitize_expense` / `receipt_to_expense`
  range checks), `schemas.py` (Pydantic: `ExpenseExtraction` / `ReceiptExtraction` = what Claude must return; `ExpenseOut` =
  camelCase response), `prompts.py` (static system prompts — no dates, so cacheable; per-request data goes in the user turn,
  transcript wrapped in `<transcript>` and declared to be data). Vercel entry `api/index.py` + `vercel.json` (Root Directory = `server`).
- Routes: `GET /health`, `POST /auth` (passphrase check, **no Claude call**), `POST /parse`, `POST /receipt`.
- Env vars: `ANTHROPIC_API_KEY`, `SPLITNOTE_PASSPHRASE` (unset → all POSTs refused), optional `SPLITNOTE_CLAUDE_MODEL`,
  `SPLITNOTE_CLAUDE_EFFORT`, `ALLOWED_ORIGINS`. **Don't name them `CLAUDE_*`** — Claude Code exports `CLAUDE_EFFORT` into shells.
- SDK: `anthropic>=2.11,<3` (API version 2026-10-21: no `temperature`/`top_p`/`top_k`). Opus 5.5 can't disable thinking —
  effort is the only knob. Errors are mapped to typed codes (`refused` 422, `rate_limited` 503, `timeout` 504, `invalid_output` 502…).
- **App** (`utils/ai/client.ts`, `utils/ai/validate.ts`, `hooks/useAiSettings.ts`, `hooks/useReceiptScan.ts`,
  `components/AiSettingsCard.tsx`): URL + passphrase stored on-device (`@splitnote/ai_settings_v1`), never in the bundle.
  `validateAiExpense()` re-checks every field (types, ranges, mode/category enums, ISO dates, names, custom shares ≤ amount).
  `utils/parseExpense.ts` tries Claude first and falls back to `parseExpenseOffline` on any failure; the banner says which
  answered ("via Claude · 1.8s" / "offline parser · <reason>").
- Receipts: `expo-image-picker` (web: the browser picker, opened inside the tap) → `expo-image-manipulator` resize to 1568 px
  JPEG q0.7 → `/receipt`. Amount = subtotal + tip (tax stays separate); line items go to the note. Friends are never set from receipts.
- Title style: 2-5 words keeping the most specific thing named — named movie/artist/team/event first ("Iron Man movie",
  "Taylor Swift concert"), `"<What> - <Place>"` for a named restaurant/store ("Dinner - Olive Garden"), destinations kept
  ("Uber to airport"), generic only when nothing specific was said. Claude fixes obvious speech-to-text mishearings of well-known
  names. The offline parser can only do the "<What> - <Place>" part; `"specific-title"` eval cases (tagged hard) measure the rest.
- Tests: `server/tests/test_app.py` (20, fake client) + `test_prompt_hygiene.py` (2) — run in CI by `.github/workflows/server-tests.yml`.
- **Prompt hygiene (do not break):** prompts and schema descriptions contain rules and `<placeholders>` only — no real names,
  places, titles or sentences. `test_prompt_hygiene.py` fails if any proper noun or 5-word phrase from
  `evals/data/parse_cases.json` appears in text Claude sees (that would inflate the LLM eval). No hardcoded outputs anywhere.

### 5.3 Evals — `evals/`
- `npm run eval` prints parser field-level + exact-match accuracy, category accuracy vs majority baseline (+ hint coverage /
  accuracy-when-shown at the UI threshold), participant recall@3 vs frequency baseline, mode accuracy vs baseline
  (+ accuracy-when-shown), outlier precision/recall, duplicate sanity check — then a **regression-gate table**.
  Any gate below its floor → exit code 1 → CI (and the web deploy) fails.
- Data: `evals/data/parse_cases.json` (64 labeled phrases; `"tags":["hard"]` = needs LLM, `"dictation"` = iPhone-dictation style, `"natural"` = rambling speech incl. the owner's real example), `evals/data/categories.json` (56 held-out titles).
- **Honesty rules (do not break):**
  - The parser's 100% on non-hard cases is a *development-set* score (cases and rules were written together; the 10 dictation
    cases were written while fixing the punctuation bug). Not real-world accuracy.
  - Recommender / mode / anomaly numbers use *synthetic* history from a seeded generator. Label them synthetic everywhere.
  - `CATEGORY_HINT_MIN_CONFIDENCE = 0.2` was chosen by sweeping on the same 56-title set (0.2 → shown on 89%, 92% correct when shown),
    so that "accuracy when shown" is optimistically biased. Re-check on real data.
  - Naive Bayes confidences are poorly calibrated (8 classes → low max-probabilities); don't present them as probabilities.
  - Gate floors catch regressions; they are not accuracy claims.
  - Only cite numbers measured on held-out or the owner's **real** expenses (target: ≥50 real entries) and say n.
- **LLM eval:** `server/evals/eval_llm.py` runs Claude on the same cases with the same field rules (Python port; verified to
  reproduce the TS offline numbers exactly) and prints offline vs Claude side by side, by tag, plus p50/p95 latency and $/request;
  writes `server/evals/results/llm-<model>-<date>.json`. Dry-run by default; `--yes` spends money — ask the owner first.
  Titles are compared strictly ("at" ≡ "-") and leniently (plurals/stop words ignored); report both.
  The natural/dictation cases were written while improving the offline rules → development set for the offline parser
  (Claude never saw them, but they are still not real-world data).

---

## 6. Web / PWA rules

- **Dialogs:** never call `Alert.alert` directly — use `showAlert()` from `utils/alert.ts` (same signature). react-native-web's
  `Alert` is a silent no-op; `showAlert` maps to `window.confirm`/`window.alert` on web and calls `onPress` synchronously
  (needed so the web import file-picker still opens).
- Platform splits use Metro's extension resolution: `utils/backup.ts` (native) vs `utils/backup.web.ts` (Blob download +
  `<input type=file>`). Keep both exports identical (`exportBackup`, `importBackup`, `BackupFile`, `ImportResult`).
- Date entry: `components/WebDateInput.tsx` on web; native keeps `@react-native-community/datetimepicker`.
- `expo-notifications` and the 6-day backup reminder are **skipped on web** (`Platform.OS` guards in `app/_layout.tsx`, `utils/autoBackup.ts`).
- GitHub Pages serves under `/<repo-name>`: `app.config.js` reads `EXPO_BASE_URL` (CI sets it). Locally leave it unset.
- `app.config.js` forces `web.output = "single"`; PWA tags are injected by `scripts/postexport.js`, which also writes `dist/404.html` (SPA deep-link fallback).
- Static assets: `public/manifest.json`, `public/apple-touch-icon.png`, `public/icon-192.png`, `public/icon-512.png`; native icon `assets/icon.png` (1024², no alpha).
- **Data is per-origin.** Changing the site URL or repo name = empty storage. Export a backup (Settings) before any move.
- Icon-only buttons need `accessibilityLabel` (VoiceOver, and the browser tests select by `aria-label`).

---

## 7. Folder structure

```
Expenz_1/
├── CLAUDE.md                      ← this file (AGENTS.md just points here)
├── app.json / app.config.js       ← Expo config (config.js adds web, baseUrl, CI build number)
├── app/
│   ├── _layout.tsx                ← root stack; notification handler is native-only
│   ├── (tabs)/{index,synced,settings,_layout}.tsx
│   └── transaction/{new,[id]}.tsx
├── components/                    ← TransactionCard, SplitBreakdown, SummaryHeader, ParticipantInput, ModeSelector,
│                                    AmountInput, EmptyState, WebDateInput, SmartHints, VoiceCapture, AiSettingsCard
├── hooks/                         ← useTransactions, useFriendSuggestions, useExpenseSuggestions, useVoiceInput,
│                                    useAiSettings, useReceiptScan
├── utils/
│   ├── calculations.ts  formatters.ts  storage.ts  uuid.ts  alert.ts  parseExpense.ts
│   ├── ai/                        ← client.ts (proxy calls, typed errors), validate.ts (response checks)
│   ├── backup.ts / backup.web.ts  autoBackup.ts
│   └── ml/                        ← on-device models (see §5.1)
├── evals/                         ← run.ts, tsconfig.json, data/*.json
├── scripts/postexport.js          ← PWA tags + 404.html after `expo export`
├── scripts/sidestore-source.js    ← writes SideStore source.json in the iOS workflow
├── server/                        ← FastAPI + Claude proxy (Vercel); see §5.2 and server/README.md
├── assets/icon.png                ← native app icon
├── public/                        ← web manifest + icons
├── .github/workflows/deploy-web.yml   ← web → Pages (on push to main)
├── .github/workflows/ios-sideload.yml ← unsigned .ipa → GitHub Release (manual / v* tag)
├── constants/ (Colors, Layout, PaymentModes)   types/index.ts
```

`ios/` and `android/` are generated by `expo prebuild` (Continuous Native Generation) and git-ignored — change native
config through `app.json` / `app.config.js` / config plugins, never by committing `ios/`.

---

## 8. Commands

```bash
npm run typecheck            # tsc --noEmit  (must be clean before every commit)
npm run eval                 # model evals + regression gates (see §5.3)
npx expo start --web         # local web dev
EXPO_BASE_URL=/splitnote npm run build:web   # production web build -> dist/ (+ PWA tags, 404.html)
npx expo install --check     # verify SDK-54-compatible dependency versions
npx expo prebuild -p ios --no-install        # sanity-check native config (no Xcode needed); delete ios/ after
cd server && .venv/bin/python -m pytest -q tests   # proxy tests (fake Claude, free)
cd server && .venv/bin/python evals/eval_llm.py    # LLM eval cost estimate; add --yes to run (paid)
```

CI:
- `deploy-web.yml` (Linux, on push to `main`): `npm ci` → typecheck → eval → build:web → deploy to Pages.
  Enable once: repo Settings → Pages → Source = **GitHub Actions**.
- `ios-sideload.yml` (macOS, manual "Run workflow" or push a `v*` tag): typecheck → prebuild → pod install →
  strip push entitlement → unsigned `xcodebuild archive` → zip `.ipa` → GitHub Release with `SplitNote.ipa` + `source.json`.
  Build number = `github.run_number` (`IOS_BUILD_NUMBER`), so SideStore sees each build as an update.
  The owner's Mac has only Command Line Tools (no Xcode), so native builds are validated in CI, not locally.

---

## 9. Coding conventions

1. TypeScript strict, **no `any`**; type every prop and return.
2. All money math in `utils/calculations.ts`; no inline arithmetic in components (legacy exceptions remain in `new.tsx` previews — move them when touched).
3. No hardcoded colors — `Colors[colorScheme]` from `constants/Colors.ts`; support light and dark.
4. No direct AsyncStorage use in components — go through `useTransactions` / `useFriendSuggestions` / `storage.ts`.
5. Currency via `formatCurrency()` (USD, en-US); dates stored as ISO strings, shown via `formatDate()`.
6. Confirm destructive actions with `showAlert()` (works on native and web).
7. Never mutate state; every mutation persists (via `mutate()` in `useTransactions`).
8. Any new native-only module needs a web fallback or a `Platform.OS` guard, and must not break `build:web` or the iOS workflow.
9. ML code stays pure and testable; every new model gets an eval (and a gate) before it is shown in the UI.
10. No secrets in the repo. The Claude key exists only as a Vercel env var.

Validation rules: title 2–80 chars; amount > 0 (cap $1,000,000); at least one participant, max 20, deduplicated case-insensitively; note ≤ 200 chars; warn but allow future dates.

---

## 10. Roadmap (in order)

1. **Deploy web build** — create public repo `splitnote`, push, enable Pages (source: GitHub Actions), verify on iPhone Safari
   that a transaction persists after closing/reopening; Add to Home Screen.
2. **Native via SideStore** — run `ios-sideload.yml`, fix anything the first macOS run surfaces, install SideStore (secondary Apple ID),
   add the source URL, install SplitNote.
3. ~~Wire Phase-1 models into `new.tsx`~~ — done.
4. ~~FastAPI proxy + voice via Claude + receipt scan~~ — built. **Owner:** deploy per `server/README.md`, then set URL +
   passphrase in Settings → AI; then run `eval_llm.py --yes` and record the numbers.
5. **Receipt eval** — a small labeled set of real receipt photos (never commit personal receipts publicly — keep them local).
6. **Real-data eval + README** — measure on ≥50 real expenses, architecture diagram, metrics table, demo GIF, live link.

## 11. Notes for Claude when working in this repo

- `expo export` output (`dist/`) and `.evalbuild/` are generated and git-ignored.
- Out of scope: direct Splitwise API integration, multi-user/cloud sync, authentication (other than the proxy passphrase).
- SideStore safety: use a secondary Apple ID; never commit pairing files (`.gitignore` covers common names).

*Last updated: 23 Nov 2026*
