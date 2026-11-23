"""SplitNote AI proxy. The only place the Anthropic API key exists.

Endpoints
  GET  /health   — liveness + whether the server is configured (no secrets revealed)
  POST /parse    — {text, today, knownFriends} -> {expense, meta}
  POST /receipt  — {imageBase64, mediaType, today} -> {expense, meta}

Security
  - Every POST needs header `X-SplitNote-Key: <passphrase>` matching env SPLITNOTE_PASSPHRASE
    (compared in constant time). No passphrase configured -> every POST is refused.
  - Request bodies are size-limited; text and image lengths are validated.
  - CORS only for ALLOWED_ORIGINS (the GitHub Pages site + localhost by default). Native apps send no Origin.
  - Logs contain route, status, latency, token counts and model — never the text or the image.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import time
from typing import Callable

import anthropic
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import claude
from .schemas import ExpenseResponse, ParseRequest, ReceiptRequest

log = logging.getLogger("splitnote")
logging.basicConfig(level=logging.INFO, format="%(message)s")

MAX_BODY_BYTES = 6_500_000  # Vercel's own request limit is ~4.5 MB; this guards local/other hosts too
DEFAULT_ORIGINS = "https://jamesratan14.github.io,http://localhost:8081,http://localhost:8765,http://localhost:19006"

app = FastAPI(title="SplitNote AI", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-SplitNote-Key"],
    max_age=3600,
)


@app.middleware("http")
async def limit_body_and_log(request: Request, call_next: Callable):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        return JSONResponse({"error": "too_large", "message": "Request is too large"}, status_code=413)
    started = time.perf_counter()
    response = await call_next(request)
    if request.method != "OPTIONS":
        log.info(json.dumps({
            "route": request.url.path,
            "status": response.status_code,
            "ms": int((time.perf_counter() - started) * 1000),
        }))
    return response


# ---------------------------------------------------------------- dependencies (overridable in tests)


def get_client() -> anthropic.Anthropic:
    return claude.make_client()


def require_passphrase(x_splitnote_key: str | None = Header(default=None)) -> None:
    expected = os.environ.get("SPLITNOTE_PASSPHRASE", "")
    if not expected:
        raise HTTPException(503, detail={"error": "not_configured", "message": "Server passphrase is not set"})
    if not x_splitnote_key or not hmac.compare_digest(x_splitnote_key.encode(), expected.encode()):
        raise HTTPException(401, detail={"error": "unauthorized", "message": "Wrong or missing passphrase"})


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    body = exc.detail if isinstance(exc.detail, dict) else {"error": "error", "message": str(exc.detail)}
    return JSONResponse(body, status_code=exc.status_code)


@app.exception_handler(claude.ClaudeError)
async def claude_error(_: Request, exc: claude.ClaudeError):
    return JSONResponse({"error": exc.code, "message": exc.message}, status_code=exc.status)


# ---------------------------------------------------------------- routes


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "model": claude.MODEL,
        "configured": bool(os.environ.get("SPLITNOTE_PASSPHRASE")) and bool(os.environ.get("ANTHROPIC_API_KEY")),
    }


@app.post("/auth", dependencies=[Depends(require_passphrase)])
def auth() -> dict:
    """Lets the app's 'Test connection' check URL + passphrase without spending Claude tokens."""
    return {"ok": True, "model": claude.MODEL, "anthropicKeySet": bool(os.environ.get("ANTHROPIC_API_KEY"))}


@app.post("/parse", response_model=ExpenseResponse, dependencies=[Depends(require_passphrase)])
def parse(body: ParseRequest, client: anthropic.Anthropic = Depends(get_client)) -> ExpenseResponse:
    expense, meta = claude.parse_expense(client, body.text, body.today, body.known_friends)
    log.info(json.dumps({"event": "parse", "model": meta.model, "ms": meta.latencyMs,
                         "in": meta.inputTokens, "out": meta.outputTokens, "warnings": meta.warnings}))
    return ExpenseResponse(expense=expense, meta=meta)


@app.post("/receipt", response_model=ExpenseResponse, dependencies=[Depends(require_passphrase)])
def receipt(body: ReceiptRequest, client: anthropic.Anthropic = Depends(get_client)) -> ExpenseResponse:
    expense, meta = claude.read_receipt(client, body.image_base64, body.media_type, body.today)
    log.info(json.dumps({"event": "receipt", "model": meta.model, "ms": meta.latencyMs,
                         "in": meta.inputTokens, "out": meta.outputTokens, "warnings": meta.warnings}))
    return ExpenseResponse(expense=expense, meta=meta)
