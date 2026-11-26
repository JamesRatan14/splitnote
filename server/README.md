# SplitNote AI server

A small FastAPI service that sits between the SplitNote app and Claude. It holds the Anthropic API key
(the app never sees it), turns speech and receipt photos into structured expense fields, and validates
Claude's output before sending it back.

```
app (voice / photo) ──► POST /parse or /receipt ──► Claude (structured output) ──► validate ──► app fills the form
         ▲                X-SplitNote-Key: <passphrase>                                         │
         └──────────── offline rule parser if anything fails (no network, timeout, refusal) ◄────┘
```

| Route | Body | Returns |
|---|---|---|
| `GET /health` | — | `{ok, model, configured}` (no secrets) |
| `POST /auth` | `{}` | `{ok, model}`: checks the passphrase **without** calling Claude |
| `POST /parse` | `{text, today, knownFriends}` | `{expense, meta}` |
| `POST /receipt` | `{imageBase64, mediaType, today}` | `{expense, meta}` |

`meta` = `{model, latencyMs, inputTokens, outputTokens, costUsd, warnings}`.

## Safety
- The **Anthropic key** exists only as a Vercel environment variable.
- Every POST needs the **passphrase** header (compared in constant time). If no passphrase is configured, the server refuses everything.
- **Size limits:** text up to 600 characters, images about 4.5 MB (the app resizes photos to 1568 px JPEG, typically 50–300 KB).
- **CORS** is limited to the GitHub Pages site and localhost.
- **Logs** hold route, status, latency and token counts only, never your text or images.
- Model output is **range-checked** on the server (amounts, dates, names, custom splits) and again in the app.
- **Refusal fallback** is on (`fallbacks: "default"`). Any failure tells the app to use its offline parser.
- Set a **monthly spend limit** in the Anthropic Console. It's the hard cap on what this can ever cost.

## Deploy to Vercel (one time, ~10 minutes)

1. **Anthropic key**
   - Go to <https://console.anthropic.com>, then **API Keys → Create key**, and copy it.
   - Under **Billing**, add a few dollars of credit.
   - Under **Limits**, set a **monthly spend limit** (e.g. $5).
2. **Passphrase:** choose a long random one. For example, run `openssl rand -base64 24` in Terminal.
3. **Vercel project:** sign in at <https://vercel.com> with GitHub, then **Add New → Project** and import `splitnote`.
   - **Root Directory:** `server` (important)
   - **Framework Preset:** Other
   - **Environment Variables:**
     - `ANTHROPIC_API_KEY` = your key
     - `SPLITNOTE_PASSPHRASE` = your passphrase
   - Click **Deploy**.
4. **Check it:** open `https://<your-project>.vercel.app/health`. You should see `"configured": true`.
5. **In the app:** go to Settings → AI, enter the URL and passphrase, and tap **Save & test**. You should see "Connected · claude-opus-5-5".

Every push to `main` that touches `server/` redeploys automatically.

### Optional settings (env vars)
| Var | Default | Notes |
|---|---|---|
| `SPLITNOTE_CLAUDE_MODEL` | `claude-opus-5-5` | `claude-haiku-5-5` is ~40× cheaper per token and faster. The eval (below) shows what you'd trade. |
| `SPLITNOTE_CLAUDE_EFFORT` | `low` | `low`/`medium`/`high`. Higher means slower and costlier. |
| `ALLOWED_ORIGINS` | Pages site + localhost | Comma-separated. |

## Develop & test

```bash
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q tests            # 20 tests, fake Claude: no key, no cost
SPLITNOTE_PASSPHRASE=dev ANTHROPIC_API_KEY=... .venv/bin/uvicorn splitnote_ai.main:app --port 8790
```

## Evaluate Claude vs the offline parser

```bash
ANTHROPIC_API_KEY=... .venv/bin/python evals/eval_llm.py          # prints the cost estimate only
ANTHROPIC_API_KEY=... .venv/bin/python evals/eval_llm.py --yes    # runs the 61 labelled cases (~$0.73 on Opus 5.5)
```

This runs the same cases and field rules as `npm run eval`. It reports accuracy by tag (plain / dictation / natural / hard),
p50/p95 latency and cost per request, and writes `evals/results/llm-<model>-<date>.json`. The cases are a development set (the
offline rules were written against them), so quote them as such, and add real expenses for a held-out number.
