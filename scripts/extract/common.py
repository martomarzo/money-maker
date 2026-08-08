"""Shared model + helpers for the BANCOS statement extractors.

Output contract: one JSON file per input statement, holding normalized rows
the app's import engine can ingest directly (see plan.md Phase 1.5).
Amounts are SIGNED integer minor units (negative = money out); PYG has 0
decimals, everything else here has 2.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field, asdict
from pathlib import Path

MINOR_EXP = {"PYG": 0}  # default 2


def minor_units(currency: str) -> int:
    return MINOR_EXP.get(currency.upper(), 2)


def to_minor(amount_str: str, currency: str, style: str) -> int:
    """Parse a bank-formatted amount into signed integer minor units.

    style: 'dot_decimal'   -> 1,234.56 / 1234.56 / -900
           'comma_decimal' -> 1.234,56 / -13.179,54  (also handles trailing '-')
           'pyg'           -> 1.501.542 (dots = thousands, integer guaraníes)
    """
    s = amount_str.strip().replace("\u00a0", " ").replace(" ", "").replace("U$S", "").replace("$", "")
    s = s.replace("Gs.", "").replace("Gs", "").strip()
    neg = False
    if s.endswith("-"):
        neg, s = True, s[:-1].strip()
    if s.startswith("-"):
        neg, s = True, s[1:].strip()
    if s.startswith("(") and s.endswith(")"):
        neg, s = True, s[1:-1].strip()
    if not s:
        raise ValueError(f"empty amount: {amount_str!r}")

    if style == "pyg":
        digits = s.replace(".", "").replace(",", "")
        value = int(digits)
    elif style == "comma_decimal":
        s = s.replace(".", "").replace(",", ".")
        value = round(float(s) * (10 ** minor_units(currency)))
    elif style == "dot_decimal":
        s = s.replace(",", "")
        value = round(float(s) * (10 ** minor_units(currency)))
    else:
        raise ValueError(f"unknown style {style}")
    return -value if neg else value


def normalize_text(s: str) -> str:
    """Collapse whitespace; keep accents (they matter for display)."""
    return re.sub(r"\s+", " ", s).strip()


def fold(s: str) -> str:
    """Accent-insensitive lowercase for matching."""
    return "".join(
        c for c in unicodedata.normalize("NFKD", s.lower()) if not unicodedata.combining(c)
    )


KINDS = {
    "purchase", "payment", "fee", "exchange", "transfer",
    "tax", "refund", "income", "unknown",
}


@dataclass
class Row:
    date: str                      # ISO yyyy-mm-dd (transaction/operation date)
    description: str
    amount_minor: int              # signed; negative = money out
    currency: str
    kind: str = "unknown"
    merchant: str | None = None
    original_amount_minor: int | None = None
    original_currency: str | None = None
    cardholder: str | None = None  # Itaú titular/adicional name
    place: str | None = None       # e.g. 'exterior' | 'paraguay'
    source_id: str | None = None   # bank-native id (Wise ID, comprobante, cupón)
    balance_minor: int | None = None  # running balance if the source has one
    extra: dict = field(default_factory=dict)  # source-specific leftovers
    raw: str = ""                  # verbatim source line/cells for audit

    def __post_init__(self) -> None:
        assert self.kind in KINDS, f"bad kind {self.kind}"


@dataclass
class Statement:
    source: str                    # revolut | wise | itau_card | santander_account | santander_visa
    source_file: str               # path relative to BANCOS/
    file_sha256: str
    account_hint: dict             # {name, type, currency, ...} suggestion for the app
    rows: list[Row] = field(default_factory=list)
    meta: dict = field(default_factory=dict)      # statement-level info (cierre, saldos…)
    validation: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def finish(self) -> None:
        """Stamp per-row dedupe keys (stable across re-runs and re-exports)."""
        occurrences: dict[str, int] = {}
        for r in self.rows:
            if r.source_id:
                base = f"{self.source}|id|{r.source_id}|{r.date}|{r.amount_minor}"
            else:
                base = f"{self.source}|{r.date}|{r.amount_minor}|{r.currency}|{fold(r.description)}"
            n = occurrences.get(base, 0)
            occurrences[base] = n + 1
            r.extra["dedupe_key"] = hashlib.sha256(f"{base}|{n}".encode()).hexdigest()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_text_guess(path: Path) -> str:
    data = path.read_bytes()
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252")


def write_statement(st: Statement, out_dir: Path) -> Path:
    st.finish()
    stem = re.sub(r"[^\w.-]+", "_", Path(st.source_file).stem)
    out = out_dir / f"{st.source}__{stem}.json"
    payload = asdict(st)
    payload["rows"] = [asdict(r) for r in st.rows]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    return out
