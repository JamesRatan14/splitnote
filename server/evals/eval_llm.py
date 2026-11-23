"""Evaluate the Claude parser against the offline rule parser on the same labelled cases.

    cd server
    ANTHROPIC_API_KEY=... .venv/bin/python evals/eval_llm.py            # prints the cost estimate, does nothing
    ANTHROPIC_API_KEY=... .venv/bin/python evals/eval_llm.py --yes      # runs it (costs real money)
    ... --limit 10 --yes                                                # quick smoke run

Reports per-field accuracy, exact match (strict and lenient titles), accuracy by tag
(plain / dictation / natural / hard), p50/p95 latency and cost, and writes the full result to
evals/results/llm-<model>-<date>.json for the README. Same cases, same field rules as evals/run.ts.

Honesty notes (keep them in any write-up):
  - These cases are a development set: the offline rules were written against them. Claude never saw them.
  - "hard" cases are the ones the rule parser is not expected to handle.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import statistics
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = HERE.parent
ROOT = SERVER.parent
sys.path.insert(0, str(SERVER))

from splitnote_ai import claude  # noqa: E402

CASES = ROOT / "evals" / "data" / "parse_cases.json"
TODAY = "2026-11-22"  # must match evals/run.ts
FIELDS = ["title", "amount", "tax", "mode", "date", "participants", "includeMe", "splitType"]
EST_COST_PER_CASE = {"claude-opus-5-5": 0.012, "claude-sonnet-5-5": 0.006, "claude-haiku-5-5": 0.0004}


def lc(s: str) -> str:
    s = re.sub(r"[^a-z0-9 ]", "", (s or "").lower())
    return re.sub(r"\s+", " ", s).strip()


def title_key(t: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r"\bat\b", " ", lc(t or ""))).strip()


STOP = {"at", "the", "a", "an", "for", "to", "of", "with", "and", "in", "on"}


def stem(w: str) -> str:
    return w[:-1] if len(w) > 3 and w.endswith("s") else w


def title_lenient(exp: str | None, got: str | None) -> bool:
    """Same content words, ignoring plurals/stop words: "Movie ticket" ~ "Movie Tickets", "Dinner at X" ~ "Dinner - X"."""
    a = {stem(w) for w in lc(exp or "").split() if w not in STOP}
    b = {stem(w) for w in lc(got or "").split() if w not in STOP}
    return a == b


def field_ok(f: str, exp: dict, got: dict) -> bool:
    if f == "title":
        return title_key(exp.get("title")) == title_key(got.get("title")) and not re.search(r"(^|\s)[.!?,;:]+(\s|$)", got.get("title") or "")
    if f in ("amount", "tax"):
        return abs((exp.get(f) or 0) - (got.get(f) or 0)) < 0.005
    if f in ("mode", "date"):
        return (exp.get(f) or None) == (got.get(f) or None)
    if f == "participants":
        return sorted(map(lc, exp.get("participants") or [])) == sorted(map(lc, got.get("participants") or []))
    if f == "includeMe":
        return bool(exp.get("includeMe", False)) == bool(got.get("includeMe", False))
    if f == "splitType":
        return exp.get("splitType", "equal") == got.get("splitType", "equal")
    raise ValueError(f)


def tag_of(case: dict) -> str:
    tags = case.get("tags") or []
    for t in ("hard", "natural", "dictation"):
        if t in tags:
            return t
    return "plain"


def offline_predictions(cases: list[dict]) -> list[dict]:
    """Runs the app's own TypeScript offline parser (compiled by `npm run eval`) on every case."""
    compiled = ROOT / ".evalbuild" / "utils" / "ml" / "offlineParser.js"
    if not compiled.exists():
        subprocess.run(["npx", "tsc", "-p", "evals/tsconfig.json"], cwd=ROOT, check=True)
    script = (
        f"const {{parseExpenseOffline}} = require({json.dumps(str(compiled))});"
        f"const cases = JSON.parse(require('fs').readFileSync({json.dumps(str(CASES))}, 'utf8'));"
        f"process.stdout.write(JSON.stringify(cases.map(c => parseExpenseOffline(c.input, {{today: {json.dumps(TODAY)}}}))));"
    )
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def score(cases: list[dict], preds: list[dict | None]) -> dict:
    per = {f: 0 for f in FIELDS}
    exact = exact_lenient = 0
    by_tag: dict[str, list[int]] = {}
    for c, p in zip(cases, preds):
        t = tag_of(c)
        by_tag.setdefault(t, [0, 0])
        by_tag[t][1] += 1
        if p is None:
            continue
        oks = {f: field_ok(f, c["expected"], p) for f in FIELDS}
        for f, ok in oks.items():
            per[f] += ok
        if all(oks.values()):
            exact += 1
            by_tag[t][0] += 1
        if all(ok for f, ok in oks.items() if f != "title") and title_lenient(c["expected"].get("title"), p.get("title")):
            exact_lenient += 1
    n = len(cases)
    return {
        "n": n,
        "field_accuracy": sum(per.values()) / (n * len(FIELDS)),
        "per_field": {f: per[f] / n for f in FIELDS},
        "exact_match": exact / n,
        "exact_match_lenient_title": exact_lenient / n,
        "exact_by_tag": {t: {"exact": a / b, "n": b} for t, (a, b) in sorted(by_tag.items())},
    }


def pct(x: float) -> str:
    return f"{100 * x:5.1f}%"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="actually call Claude (costs money)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    cases = json.loads(CASES.read_text())
    if args.limit:
        cases = cases[: args.limit]
    est = EST_COST_PER_CASE.get(claude.MODEL, 0.012) * len(cases)
    print(f"Model {claude.MODEL} (effort {claude.EFFORT}), {len(cases)} cases, estimated cost ~${est:.2f}")
    if not args.yes:
        print("Dry run. Re-run with --yes to call Claude.")
        return
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("Set ANTHROPIC_API_KEY first.")

    client = claude.make_client()

    def run(case: dict):
        try:
            out, meta = claude.parse_expense(client, case["input"], TODAY, [])
            return out.model_dump(), meta.model_dump(), None
        except claude.ClaudeError as e:
            return None, None, f"{e.code}: {e.message}"

    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(run, cases))

    llm_preds = [r[0] for r in results]
    metas = [r[1] for r in results if r[1]]
    errors = [(c["input"], r[2]) for c, r in zip(cases, results) if r[2]]
    offline = offline_predictions(json.loads(CASES.read_text()))[: len(cases)]

    s_llm, s_off = score(cases, llm_preds), score(cases, offline)
    lat = sorted(m["latencyMs"] for m in metas) or [0]
    cost = sum(m["costUsd"] for m in metas)
    p95 = lat[min(len(lat) - 1, int(round(0.95 * (len(lat) - 1))))]

    print(f"\n{'':34}{'offline rules':>15}{'Claude':>12}")
    print(f"{'field-level accuracy':34}{pct(s_off['field_accuracy']):>15}{pct(s_llm['field_accuracy']):>12}")
    print(f"{'exact match (strict title)':34}{pct(s_off['exact_match']):>15}{pct(s_llm['exact_match']):>12}")
    print(f"{'exact match (lenient title)':34}{pct(s_off['exact_match_lenient_title']):>15}{pct(s_llm['exact_match_lenient_title']):>12}")
    for f in FIELDS:
        print(f"{'  ' + f:34}{pct(s_off['per_field'][f]):>15}{pct(s_llm['per_field'][f]):>12}")
    for t in s_llm["exact_by_tag"]:
        n = s_llm["exact_by_tag"][t]["n"]
        print(f"{'  exact, ' + t + f' (n={n})':34}{pct(s_off['exact_by_tag'][t]['exact']):>15}{pct(s_llm['exact_by_tag'][t]['exact']):>12}")
    print(f"\nlatency p50 {statistics.median(lat)} ms, p95 {p95} ms · total cost ${cost:.4f} (${cost / max(len(metas), 1):.4f}/request)")
    if errors:
        print(f"{len(errors)} request(s) failed:")
        for i, e in errors:
            print(f"  x {i[:60]!r}: {e}")

    misses = []
    for c, p in zip(cases, llm_preds):
        if p and not all(field_ok(f, c["expected"], p) for f in FIELDS):
            bad = [f for f in FIELDS if not field_ok(f, c["expected"], p)]
            misses.append({"input": c["input"], "wrong": bad, "got": {f: p.get(f) for f in bad}, "expected": {f: c["expected"].get(f) for f in bad}})
    if misses:
        print("\nClaude misses:")
        for m in misses:
            print(f"  x {m['input'][:70]!r} -> {m['wrong']} got {m['got']}")

    out_dir = HERE / "results"
    out_dir.mkdir(exist_ok=True)
    path = out_dir / f"llm-{claude.MODEL}-{dt.date.today().isoformat()}.json"
    path.write_text(json.dumps({
        "model": claude.MODEL, "effort": claude.EFFORT, "cases": len(cases), "today": TODAY,
        "offline": s_off, "claude": s_llm,
        "latency_ms": {"p50": statistics.median(lat), "p95": p95}, "cost_usd_total": cost,
        "errors": errors, "claude_misses": misses,
        "note": "Development set (rules written against these cases); Claude never saw them.",
    }, indent=2))
    print(f"\nwrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
