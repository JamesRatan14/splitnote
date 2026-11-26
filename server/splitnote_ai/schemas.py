"""Pydantic models: what Claude must return (structured output) and what the API returns to the app.

Field names in the *extraction* models are snake_case and documented, because the JSON schema
generated from them (descriptions included) is what Claude sees. The *response* models are
camelCase to match the app's TypeScript `Transaction` fields.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

PaymentMode = Literal["Cash", "Credit Card", "Debit Card", "Zelle", "Apple Pay", "Other"]
Category = Literal[
    "Food & Drink", "Groceries", "Transport", "Entertainment", "Travel", "Shopping", "Utilities", "Other"
]

# ---------------------------------------------------------------- Claude output (structured)


class CustomShare(BaseModel):
    name: str = Field(description="Friend's name, spelled exactly as in `participants`.")
    amount: float = Field(description="That friend's pre-tax share in USD.")


class ExpenseExtraction(BaseModel):
    is_expense: bool = Field(description="False if the text does not describe something the user paid for.")
    title: str = Field(
        description='2-5 words, keeping the most specific thing named: "Iron Man movie", "Taylor Swift concert", '
        '"Dinner - Olive Garden", "Uber to airport"; generic only if nothing specific was said ("Movie tickets"). '
        "Never include amounts, dates or friends' names."
    )
    category: Category
    merchant: Optional[str] = Field(description="Merchant or place name if mentioned, else null.")
    amount: Optional[float] = Field(
        description="Pre-tax subtotal in USD the user paid. Only a total given -> the total. null if no amount."
    )
    tax: Optional[float] = Field(description="Tax in USD if mentioned (convert a percentage using the amount), else null.")
    mode: Optional[PaymentMode] = Field(description="Payment method if stated; Venmo/PayPal/Cash App -> Other. Else null.")
    date: Optional[str] = Field(description="YYYY-MM-DD if a date is stated or implied (e.g. 'yesterday'), else null.")
    participants: list[str] = Field(description="Friends sharing the cost. Never the user. Only actual names.")
    include_me: bool = Field(description="True if the user also shares the cost (e.g. 'split between us', 'both of us').")
    split_type: Literal["equal", "custom"] = Field(description='"custom" only if per-person amounts are stated.')
    custom_amounts: list[CustomShare] = Field(description="Per-friend pre-tax shares when split_type is custom, else [].")
    note: Optional[str] = Field(
        description="Only context the user explicitly stated that fits no other field (max ~15 words). "
        "Usually null. No guesses, no reasoning, no remarks about the transcript."
    )


class ReceiptItem(BaseModel):
    name: str
    amount: float


class ReceiptExtraction(BaseModel):
    is_receipt: bool = Field(description="False if the image is not a purchase receipt or bill.")
    merchant: Optional[str] = Field(description="Store/restaurant name as printed, in Title Case, else null.")
    title: str = Field(description='"<What> - <Merchant>", e.g. "Food - Olive Garden", "Groceries - Wegmans".')
    category: Category
    date: Optional[str] = Field(description="Purchase date as YYYY-MM-DD, else null.")
    subtotal: Optional[float] = Field(description="Pre-tax subtotal in USD, else null.")
    tax: Optional[float] = Field(description="Total tax in USD, else null.")
    tip: Optional[float] = Field(description="Tip/gratuity in USD, else null.")
    total: Optional[float] = Field(description="Grand total paid in USD, else null.")
    mode: Optional[PaymentMode] = Field(
        description="Only if the receipt clearly shows it (e.g. CASH, Apple Pay, DEBIT). A card brand alone -> Credit Card. Else null."
    )
    items: list[ReceiptItem] = Field(description="Line items (max 30), names shortened to a few words.")


# ---------------------------------------------------------------- API request / response


class ParseRequest(BaseModel):
    text: str = Field(min_length=2, max_length=600)
    today: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    known_friends: list[str] = Field(default_factory=list, max_length=200, alias="knownFriends")

    model_config = {"populate_by_name": True}


class ReceiptRequest(BaseModel):
    image_base64: str = Field(min_length=100, max_length=6_000_000, alias="imageBase64")
    media_type: Literal["image/jpeg", "image/png", "image/webp"] = Field(default="image/jpeg", alias="mediaType")
    today: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")

    model_config = {"populate_by_name": True}


class ExpenseOut(BaseModel):
    """Mirrors the app's ParsedExpense (camelCase). Only validated, in-range values reach here."""

    title: Optional[str] = None
    category: Optional[Category] = None
    amount: Optional[float] = None
    tax: Optional[float] = None
    mode: Optional[PaymentMode] = None
    date: Optional[str] = None
    participants: list[str] = Field(default_factory=list)
    includeMe: bool = False
    splitType: Literal["equal", "custom"] = "equal"
    customAmounts: Optional[dict[str, float]] = None
    note: Optional[str] = None


class Meta(BaseModel):
    model: str
    latencyMs: int
    inputTokens: int
    outputTokens: int
    costUsd: float
    warnings: list[str] = Field(default_factory=list)


class ExpenseResponse(BaseModel):
    expense: ExpenseOut
    meta: Meta
