"""Claude calls for expense parsing and receipt reading, plus validation of the model's output.

Uses structured outputs (`beta.messages.parse` with a Pydantic `output_format`) so the reply is
schema-valid JSON, then range-checks it here before anything is returned to the app.
"""

from __future__ import annotations

import datetime as dt
import os
import re
import time
from dataclasses import dataclass
from typing import Optional, TypeVar

import anthropic
from pydantic import BaseModel, ValidationError

from .prompts import PARSE_SYSTEM, RECEIPT_SYSTEM
import json

from .schemas import DraftIn, ExpenseExtraction, ExpenseOut, Meta, ReceiptExtraction

MODEL = os.environ.get("SPLITNOTE_CLAUDE_MODEL", "claude-opus-5-5")
EFFORT = os.environ.get("SPLITNOTE_CLAUDE_EFFORT", "low")  # extraction is simple; low keeps latency + cost down
MAX_TOKENS = 8000

# USD per 1M tokens (input, output) — for the cost shown in logs / evals only.
PRICES: dict[str, tuple[float, float]] = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
}

# Models that accept the server-side refusal fallback (`fallbacks: "default"`).
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1", "claude-opus-5"}

T = TypeVar("T", bound=BaseModel)


class ClaudeError(Exception):
    """Anything that means 'no usable answer' — the app falls back to its offline parser."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass
class CallResult:
    data: BaseModel
    meta: Meta


def make_client() -> anthropic.Anthropic:
    # Reads ANTHROPIC_API_KEY from the server environment. Short timeout: a person is waiting.
    return anthropic.Anthropic(timeout=25.0, max_retries=1)


def _call(client: anthropic.Anthropic, system: str, content: list[dict], output: type[T]) -> tuple[T, Meta]:
    extra: dict = {}
    if MODEL in FALLBACK_MODELS:
        extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}

    started = time.perf_counter()
    try:
        response = client.beta.messages.parse(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": EFFORT},
            output_format=output,
            **extra,
        )
    except ValidationError as e:  # reply didn't match the schema
        raise ClaudeError(502, "invalid_output", "Model returned output that did not match the schema") from e
    except anthropic.AuthenticationError as e:
        raise ClaudeError(502, "server_key", "The server's Anthropic API key is invalid") from e
    except anthropic.PermissionDeniedError as e:
        raise ClaudeError(502, "server_key", "The server's Anthropic API key lacks permission") from e
    except anthropic.RateLimitError as e:
        raise ClaudeError(503, "rate_limited", "Claude is rate limited, try again shortly") from e
    except anthropic.BadRequestError as e:
        raise ClaudeError(502, "bad_request", f"Claude rejected the request: {e.message}") from e
    except anthropic.APITimeoutError as e:
        raise ClaudeError(504, "timeout", "Claude took too long") from e
    except anthropic.APIConnectionError as e:
        raise ClaudeError(504, "network", "Could not reach Claude") from e
    except anthropic.APIStatusError as e:
        raise ClaudeError(502, "upstream", f"Claude error {e.status_code}") from e
    latency_ms = int((time.perf_counter() - started) * 1000)

    if response.stop_reason == "refusal":
        raise ClaudeError(422, "refused", "Claude declined this request")
    if response.stop_reason == "max_tokens":
        raise ClaudeError(502, "truncated", "Claude's reply was cut off")
    parsed = response.parsed_output
    if parsed is None:
        raise ClaudeError(502, "invalid_output", "Claude returned no structured output")

    usage = response.usage
    in_price, out_price = PRICES.get(response.model, PRICES.get(MODEL, (0.0, 0.0)))
    input_tokens = (usage.input_tokens or 0) + (usage.cache_read_input_tokens or 0) + (usage.cache_creation_input_tokens or 0)
    cost = ((usage.input_tokens or 0) * in_price + (usage.output_tokens or 0) * out_price) / 1_000_000
    meta = Meta(
        model=response.model,
        latencyMs=latency_ms,
        inputTokens=input_tokens,
        outputTokens=usage.output_tokens or 0,
        costUsd=round(cost, 6),
    )
    return parsed, meta


# ---------------------------------------------------------------- public entry points


def parse_expense(
    client: anthropic.Anthropic,
    text: str,
    today: str,
    known_friends: list[str],
    current: Optional[DraftIn] = None,
) -> tuple[ExpenseOut, Meta]:
    weekday = dt.date.fromisoformat(today).strftime("%A")
    friends = ", ".join(_clean_name(n) for n in known_friends[:200] if _clean_name(n)) or "(none yet)"
    draft = ""
    if current is not None and (current.title or current.amount or current.participants):
        draft = f"<current_draft>\n{json.dumps(current.model_dump(exclude_none=True))}\n</current_draft>\n\n"
    user = (
        f"Today: {today} ({weekday})\n"
        f"Known friends: {friends}\n\n"
        f"{draft}"
        f"<transcript>\n{text.strip()}\n</transcript>"
    )
    parsed, meta = _call(client, PARSE_SYSTEM, [{"type": "text", "text": user}], ExpenseExtraction)
    out, warnings = sanitize_expense(parsed, today, known_friends)
    meta.warnings = warnings
    return out, meta


def read_receipt(client: anthropic.Anthropic, image_b64: str, media_type: str, today: str) -> tuple[ExpenseOut, Meta]:
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
        {"type": "text", "text": f"Today: {today}. Extract this receipt."},
    ]
    parsed, meta = _call(client, RECEIPT_SYSTEM, content, ReceiptExtraction)
    out, warnings = receipt_to_expense(parsed, today)
    meta.warnings = warnings
    return out, meta


# ---------------------------------------------------------------- validation of model output

_NOT_NAMES = {
    "me", "i", "myself", "you", "us", "we", "my friend", "friend", "friends", "roommate", "roommates",
    "everyone", "all", "him", "her", "them", "someone", "the user", "user",
}
MAX_AMOUNT = 1_000_000


def _clean_name(name: str) -> str:
    n = re.sub(r"\s+", " ", str(name)).strip(" .,;:!?\"'")
    return n[:40]


def _valid_money(x: Optional[float], *, allow_zero: bool = False) -> Optional[float]:
    if x is None or not isinstance(x, (int, float)) or x != x:  # None / NaN
        return None
    if x < 0 or x > MAX_AMOUNT or (x == 0 and not allow_zero):
        return None
    return round(float(x), 2)


def _valid_date(s: Optional[str], today: str) -> Optional[str]:
    if not s:
        return None
    try:
        d = dt.date.fromisoformat(s)
    except ValueError:
        return None
    t = dt.date.fromisoformat(today)
    # plausible window for a logbook entry
    if d < t - dt.timedelta(days=400) or d > t + dt.timedelta(days=31):
        return None
    return d.isoformat()


def _title(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    t = re.sub(r"\s+", " ", s).strip(" .,;:")
    return t[:80] or None


def sanitize_expense(x: ExpenseExtraction, today: str, known_friends: list[str]) -> tuple[ExpenseOut, list[str]]:
    warnings: list[str] = []
    if not x.is_expense:
        warnings.append("not_an_expense")

    amount = _valid_money(x.amount)
    if x.amount is not None and amount is None:
        warnings.append("amount_out_of_range")
    tax = _valid_money(x.tax)
    if tax is not None and amount is not None and tax >= amount:
        tax = None
        warnings.append("tax_dropped")

    known = {k.lower(): k for k in (_clean_name(n) for n in known_friends) if k}
    participants: list[str] = []
    seen: set[str] = set()
    for raw in x.participants:
        n = _clean_name(raw)
        if not n or n.lower() in _NOT_NAMES:
            continue
        n = known.get(n.lower(), n)
        if n.lower() in seen:
            continue
        seen.add(n.lower())
        participants.append(n)
    participants = participants[:20]

    split_type = "equal"
    custom: Optional[dict[str, float]] = None
    if x.split_type == "custom" and participants:
        shares = {known.get(_clean_name(c.name).lower(), _clean_name(c.name)): _valid_money(c.amount) for c in x.custom_amounts}
        if all(shares.get(p) for p in participants):
            total = sum(shares[p] or 0 for p in participants)
            if amount is None or total <= amount + 0.01:
                split_type = "custom"
                custom = {p: shares[p] or 0.0 for p in participants}
        if split_type != "custom":
            warnings.append("custom_split_dropped")

    note = (x.note or "").strip()[:200] or None
    return (
        ExpenseOut(
            title=_title(x.title),
            category=x.category,
            amount=amount,
            tax=tax,
            mode=x.mode,
            date=_valid_date(x.date, today),
            participants=participants,
            includeMe=bool(x.include_me),
            splitType=split_type,
            customAmounts=custom,
            note=note,
        ),
        warnings,
    )


def receipt_to_expense(r: ReceiptExtraction, today: str) -> tuple[ExpenseOut, list[str]]:
    warnings: list[str] = []
    if not r.is_receipt:
        warnings.append("not_a_receipt")
    subtotal = _valid_money(r.subtotal)
    tax = _valid_money(r.tax)
    tip = _valid_money(r.tip)
    total = _valid_money(r.total)

    # The app stores the pre-tax amount separately from tax; a tip is part of what's split, so it joins the amount.
    if subtotal is not None:
        amount: Optional[float] = round(subtotal + (tip or 0), 2)
    elif total is not None:
        amount = round(total - (tax or 0), 2)
    else:
        amount = None
    if amount is not None and amount <= 0:
        amount = None
    if total is not None and amount is not None and abs(amount + (tax or 0) - total) > 0.05:
        warnings.append("totals_do_not_add_up")

    items = [i for i in r.items[:30] if i.name.strip()]
    note = None
    if items:
        note = ", ".join(i.name.strip() for i in items)
        note = (note[:197] + "...") if len(note) > 200 else note

    return (
        ExpenseOut(
            title=_title(r.title),
            category=r.category,
            amount=amount,
            tax=tax if tax and (amount is None or tax < amount) else None,
            mode=r.mode,
            date=_valid_date(r.date, today),
            note=note,
        ),
        warnings,
    )
