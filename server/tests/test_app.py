"""Offline tests for the proxy: a fake Anthropic client stands in for Claude (no key, no cost)."""

from __future__ import annotations

import os
import sys
from types import SimpleNamespace

import anthropic
import httpx2
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from splitnote_ai import main  # noqa: E402
from splitnote_ai.schemas import CustomShare, ExpenseExtraction, ReceiptExtraction, ReceiptItem  # noqa: E402

KEY = "correct horse battery staple"
TODAY = "2026-11-23"


class FakeMessages:
    def __init__(self, result=None, exc: Exception | None = None, stop_reason: str = "end_turn"):
        self.result, self.exc, self.stop_reason = result, exc, stop_reason
        self.calls: list[dict] = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        if self.exc:
            raise self.exc
        return SimpleNamespace(
            stop_reason=self.stop_reason,
            parsed_output=self.result,
            model=kwargs["model"],
            usage=SimpleNamespace(input_tokens=900, output_tokens=150, cache_read_input_tokens=0, cache_creation_input_tokens=0),
        )


def make_app(fake: FakeMessages) -> TestClient:
    main.app.dependency_overrides[main.get_client] = lambda: SimpleNamespace(beta=SimpleNamespace(messages=fake))
    return TestClient(main.app)


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("SPLITNOTE_PASSPHRASE", KEY)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    yield
    main.app.dependency_overrides.clear()


def expense(**over) -> ExpenseExtraction:
    base = dict(
        is_expense=True, title="Movie tickets", category="Entertainment", merchant=None, amount=30.0, tax=None,
        mode=None, date=None, participants=["D"], include_me=True, split_type="equal", custom_amounts=[], note=None,
    )
    base.update(over)
    return ExpenseExtraction(**base)


H = {"X-SplitNote-Key": KEY}
BODY = {"text": "I paid a movie ticket total $30 split between me and my friend D", "today": TODAY, "knownFriends": ["Rahul"]}


# ---------------------------------------------------------------- auth & limits


def test_health_reveals_no_secrets():
    r = make_app(FakeMessages()).get("/health")
    assert r.status_code == 200
    assert r.json()["configured"] is True
    assert KEY not in r.text and "sk-test" not in r.text


def test_missing_or_wrong_passphrase_is_401():
    c = make_app(FakeMessages(expense()))
    assert c.post("/parse", json=BODY).status_code == 401
    assert c.post("/parse", json=BODY, headers={"X-SplitNote-Key": "nope"}).status_code == 401


def test_auth_check_needs_passphrase_and_spends_nothing():
    fake = FakeMessages(expense())
    c = make_app(fake)
    assert c.post("/auth", json={}).status_code == 401
    r = c.post("/auth", json={}, headers=H)
    assert r.status_code == 200 and r.json()["ok"] is True and fake.calls == []


def test_no_passphrase_configured_refuses_everything(monkeypatch):
    monkeypatch.delenv("SPLITNOTE_PASSPHRASE")
    r = make_app(FakeMessages(expense())).post("/parse", json=BODY, headers=H)
    assert r.status_code == 503 and r.json()["error"] == "not_configured"


def test_text_too_long_rejected_before_calling_claude():
    fake = FakeMessages(expense())
    r = make_app(fake).post("/parse", json={**BODY, "text": "x" * 601}, headers=H)
    assert r.status_code == 422 and fake.calls == []


def test_huge_body_rejected():
    r = make_app(FakeMessages()).post("/receipt", content=b"x" * 7_000_000, headers={**H, "Content-Type": "application/json"})
    assert r.status_code == 413


def test_cors_allows_pages_origin_only():
    c = make_app(FakeMessages())
    pre = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-splitnote-key,content-type"}
    ok = c.options("/parse", headers={**pre, "Origin": "https://jamesratan14.github.io"})
    assert ok.headers.get("access-control-allow-origin") == "https://jamesratan14.github.io"
    bad = c.options("/parse", headers={**pre, "Origin": "https://evil.example"})
    assert bad.headers.get("access-control-allow-origin") is None


# ---------------------------------------------------------------- request shape


def test_request_sent_to_claude():
    fake = FakeMessages(expense())
    r = make_app(fake).post("/parse", json=BODY, headers=H)
    assert r.status_code == 200
    call = fake.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["output_config"] == {"effort": "low"}
    assert call["output_format"] is ExpenseExtraction
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert "temperature" not in call and "thinking" not in call
    user_text = call["messages"][0]["content"][0]["text"]
    assert "<transcript>" in user_text and BODY["text"] in user_text
    assert "Today: 2026-11-23 (Monday)" in user_text and "Known friends: Rahul" in user_text
    assert "2026" not in call["system"]  # system prompt stays static (cache-friendly)


def test_response_shape_and_cost():
    r = make_app(FakeMessages(expense())).post("/parse", json=BODY, headers=H).json()
    assert r["expense"] == {
        "title": "Movie tickets", "category": "Entertainment", "amount": 30.0, "tax": None, "mode": None,
        "date": None, "participants": ["D"], "includeMe": True, "splitType": "equal", "customAmounts": None, "note": None,
    }
    assert r["meta"]["inputTokens"] == 900 and r["meta"]["outputTokens"] == 150
    assert r["meta"]["costUsd"] == pytest.approx((900 * 4 + 150 * 20) / 1e6)


# ---------------------------------------------------------------- validation of model output


def test_sanitizes_participants():
    fake = FakeMessages(expense(participants=["rahul", "me", "My friend", "Priya ", "priya", "  "]))
    r = make_app(fake).post("/parse", json=BODY, headers=H).json()
    assert r["expense"]["participants"] == ["Rahul", "Priya"]  # known spelling, no "me", deduped


def test_drops_out_of_range_values():
    fake = FakeMessages(expense(amount=5_000_000, tax=3.0, date="1999-01-01"))
    r = make_app(fake).post("/parse", json=BODY, headers=H).json()
    assert r["expense"]["amount"] is None and r["expense"]["date"] is None
    assert "amount_out_of_range" in r["meta"]["warnings"]


def test_tax_not_less_than_amount_dropped():
    r = make_app(FakeMessages(expense(amount=10, tax=12))).post("/parse", json=BODY, headers=H).json()
    assert r["expense"]["tax"] is None and "tax_dropped" in r["meta"]["warnings"]


def test_custom_split_kept_when_consistent():
    x = expense(amount=90, participants=["Rahul", "Priya"], split_type="custom",
                custom_amounts=[CustomShare(name="Rahul", amount=25), CustomShare(name="Priya", amount=25)])
    r = make_app(FakeMessages(x)).post("/parse", json=BODY, headers=H).json()
    assert r["expense"]["splitType"] == "custom" and r["expense"]["customAmounts"] == {"Rahul": 25.0, "Priya": 25.0}


def test_custom_split_dropped_when_shares_exceed_amount():
    x = expense(amount=40, participants=["Rahul", "Priya"], split_type="custom",
                custom_amounts=[CustomShare(name="Rahul", amount=30), CustomShare(name="Priya", amount=30)])
    r = make_app(FakeMessages(x)).post("/parse", json=BODY, headers=H).json()
    assert r["expense"]["splitType"] == "equal" and "custom_split_dropped" in r["meta"]["warnings"]


# ---------------------------------------------------------------- failures -> app falls back offline


def test_refusal_is_422():
    r = make_app(FakeMessages(expense(), stop_reason="refusal")).post("/parse", json=BODY, headers=H)
    assert r.status_code == 422 and r.json()["error"] == "refused"


def test_schema_mismatch_is_502():
    try:
        ExpenseExtraction.model_validate({"title": 1})
    except ValidationError as e:
        err = e
    r = make_app(FakeMessages(exc=err)).post("/parse", json=BODY, headers=H)
    assert r.status_code == 502 and r.json()["error"] == "invalid_output"


def test_timeout_is_504():
    exc = anthropic.APITimeoutError(request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages"))
    r = make_app(FakeMessages(exc=exc)).post("/parse", json=BODY, headers=H)
    assert r.status_code == 504 and r.json()["error"] == "timeout"


# ---------------------------------------------------------------- receipts


def receipt(**over) -> ReceiptExtraction:
    base = dict(
        is_receipt=True, merchant="Olive Garden", title="Food - Olive Garden", category="Food & Drink",
        date="2026-11-21", subtotal=62.40, tax=5.15, tip=12.00, total=79.55, mode="Credit Card",
        items=[ReceiptItem(name="Chicken Alfredo", amount=21.99), ReceiptItem(name="Breadsticks", amount=0)],
    )
    base.update(over)
    return ReceiptExtraction(**base)


RB = {"imageBase64": "A" * 200, "mediaType": "image/jpeg", "today": TODAY}


def test_receipt_maps_to_expense():
    fake = FakeMessages(receipt())
    r = make_app(fake).post("/receipt", json=RB, headers=H).json()
    e = r["expense"]
    assert e["title"] == "Food - Olive Garden" and e["amount"] == 74.40 and e["tax"] == 5.15  # subtotal + tip
    assert e["date"] == "2026-11-21" and e["mode"] == "Credit Card"
    assert e["note"] == "Chicken Alfredo, Breadsticks"
    assert r["meta"]["warnings"] == []
    img = fake.calls[0]["messages"][0]["content"][0]
    assert img["type"] == "image" and img["source"]["media_type"] == "image/jpeg"


def test_receipt_totals_mismatch_warns():
    r = make_app(FakeMessages(receipt(total=99.0))).post("/receipt", json=RB, headers=H).json()
    assert "totals_do_not_add_up" in r["meta"]["warnings"]


def test_receipt_without_subtotal_uses_total_minus_tax():
    r = make_app(FakeMessages(receipt(subtotal=None, tip=None))).post("/receipt", json=RB, headers=H).json()
    assert r["expense"]["amount"] == round(79.55 - 5.15, 2)


# ---------------------------------------------------------------- editing an existing draft by voice


def test_current_draft_is_sent_for_edits():
    fake = FakeMessages(expense(amount=50.0))
    body = {**BODY, "text": "make it fifty dollars", "current": {"title": "Movie tickets", "amount": 30, "participants": ["D"], "includeMe": True}}
    r = make_app(fake).post("/parse", json=body, headers=H)
    assert r.status_code == 200
    user_text = fake.calls[0]["messages"][0]["content"][0]["text"]
    assert "<current_draft>" in user_text and '"amount": 30.0' in user_text and '"participants": ["D"]' in user_text
    assert user_text.index("<current_draft>") < user_text.index("<transcript>")


def test_empty_draft_is_not_sent():
    fake = FakeMessages(expense())
    make_app(fake).post("/parse", json={**BODY, "current": {"participants": [], "includeMe": False}}, headers=H)
    assert "<current_draft>" not in fake.calls[0]["messages"][0]["content"][0]["text"]


def test_draft_is_validated():
    fake = FakeMessages(expense())
    r = make_app(fake).post("/parse", json={**BODY, "current": {"title": "x" * 81}}, headers=H)
    assert r.status_code == 422 and fake.calls == []
