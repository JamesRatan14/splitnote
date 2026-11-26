"""Guards eval honesty: the prompts/schemas Claude sees must not contain names or phrases from the
eval cases, otherwise the LLM eval score is inflated. Rules + <placeholders> only."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from anthropic.lib._parse._transform import to_json_output_format  # noqa: E402

from splitnote_ai.prompts import PARSE_SYSTEM, RECEIPT_SYSTEM  # noqa: E402
from splitnote_ai.schemas import ExpenseExtraction, ReceiptExtraction  # noqa: E402

CASES = Path(__file__).resolve().parents[2] / "evals" / "data" / "parse_cases.json"
# The app's own vocabulary (payment-mode enum values, the pronoun I) is allowed in prompts.
ALLOWED = {"I", "Zelle", "Apple", "Pay", "Cash", "Credit", "Card", "Debit", "Other", "Venmo", "PayPal", "App"}


def claude_visible_text() -> str:
    schemas = json.dumps([to_json_output_format(ExpenseExtraction), to_json_output_format(ReceiptExtraction)])
    return PARSE_SYSTEM + "\n" + RECEIPT_SYSTEM + "\n" + schemas


def eval_proper_nouns() -> set[str]:
    names: set[str] = set()
    for case in json.loads(CASES.read_text()):
        exp = case["expected"]
        names.update(exp.get("participants") or [])
        # capitalised words that aren't sentence-initial, from the input and the expected title
        for text in (case["input"], exp.get("title") or ""):
            words = re.findall(r"[A-Za-z][\w'&-]*", text)
            names.update(w for w in words[1:] if w[0].isupper())
    return {n for n in names if n not in ALLOWED and len(n) > 1}


def test_no_eval_names_in_prompts():
    text = claude_visible_text()
    leaked = sorted(n for n in eval_proper_nouns() if re.search(rf"\b{re.escape(n)}\b", text))
    assert leaked == [], f"eval names appear in prompts/schemas: {leaked}"


def test_no_eval_sentences_in_prompts():
    text = claude_visible_text().lower()
    for case in json.loads(CASES.read_text()):
        words = re.findall(r"[a-z0-9$.']+", case["input"].lower())
        # any 5-word run copied from an eval input counts as leakage
        for i in range(len(words) - 4):
            chunk = " ".join(words[i : i + 5])
            assert chunk not in text, f"eval phrase in prompt: {chunk!r}"
