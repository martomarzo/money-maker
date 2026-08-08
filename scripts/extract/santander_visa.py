"""Santander Argentina Visa credit-card resumen PDF.

Extracted with `pdftotext -table`. Transaction table (page 1; later pages are
legal boilerplate under a repeated header):

  Fecha      Comprobante Referencia                        $              U$S
             SALDO ANTERIOR                             1.111,11         11,11
  25 Julio   04           SU PAGO EN PESOS   2.222,22 TC1000,000   1.111,11-  11,11-
  25 Junio   28 111111 *  MERCHANT ONE                                333,33
             06 222222    MERCHANT TWO 123456 USD   9,99                       9,99
  Tarjeta 1234 Total Consumos de FIRSTNAME LASTNAME        333,33 *       9,99 *

Quirks: dates are "yy MonthName dd" with day-only continuation rows that
inherit year+month; negatives use a trailing '-'; a purchase can hit the $
or the U$S column (its own currency); mid-description numbers (original USD
amount, TC exchange rate) sit left of the amount columns and are ignored by
column offset. "Tarjeta NNNN Total Consumos de NAME" closes a cardholder
block — its stated totals validate our parsed sums; the block's rows get
that cardholder name.

Statement sign convention: charges positive, payments/credits trailing-minus.
Normalized: negative = money out, so amounts are NEGATED (like Itaú).
"""

from __future__ import annotations

import re
from pathlib import Path

from common import Row, Statement, fold, normalize_text, sha256_file, to_minor
from santander_account import PDFTOTEXT, pdf_to_table_text  # same extraction

MONEY_RE = re.compile(r"[\d.]+,\d{2}-?")
HEADER_RE = re.compile(r"^Fecha\s+Comprobante\s+Referencia")
TOTAL_RE = re.compile(r"^Tarjeta\s+(\d{4})\s+Total Consumos de\s+(.+?)\s*[\d.]", re.IGNORECASE)
ROW_START_RE = re.compile(r"^(?:(\d{2})\s+([A-Za-zñÑ]+)\.?\s+)?(\d{2})\s")
# Consecutive same-day rows drop the date entirely and start at the
# comprobante: "   111111 *  SOME MERCHANT   123,45"
COMPROBANTE_START_RE = re.compile(r"^(\d{6})\s*(?:[A-Z*]\s)?")

MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}

STOP_MARKERS = (
    "plan v:", "saldo actual", "pago minimo", "el presente es copia",
    "tna:", "cfteaejemplo", "total consumos del periodo",
)


def detect(path: Path) -> float:
    if path.suffix.lower() != ".pdf":
        return 0.0
    return 0.9 if "visa" in fold(path.stem) else 0.0


def _kind(description: str) -> str:
    d = fold(description)
    if "su pago" in d or "cancel.deuda" in d:
        return "payment"
    if "cred. premio" in d or "cred.premio" in d:
        return "income"  # bank reward credit — not part of "Total Consumos"
    if any(k in d for k in ("iibb", "iva ", "iva rg", "db.rg", "percep", "sellos", "impuesto")):
        return "tax"
    if any(k in d for k in ("seg.", "seguro", "interes", "cargo", "comision")):
        return "fee"
    return "purchase"


def parse(path: Path, rel: str) -> Statement:
    text = pdf_to_table_text(path)
    lines = text.splitlines()

    rows: list[Row] = []
    meta: dict = {}
    warnings: list[str] = []
    blocks: list[dict] = []

    dollar_off: int | None = None
    usd_off: int | None = None
    armed = False
    year = month = day = None
    block_start = 0  # index into rows where the current cardholder block began

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        f = fold(stripped)

        if HEADER_RE.match(stripped):
            usd_off = line.rfind("U$S")
            dollar_off = line.rfind("$", 0, usd_off - 1) if usd_off > 0 else line.rfind("$")
            armed = dollar_off > 0 and usd_off > dollar_off
            continue
        if not armed:
            continue
        if any(f.startswith(m) or m in f[:40] for m in STOP_MARKERS):
            armed = False
            continue

        tm = TOTAL_RE.match(stripped)
        if tm:
            card, holder = tm.group(1), normalize_text(tm.group(2))
            block_rows = rows[block_start:]
            for r in block_rows:
                if r.kind in ("purchase", "refund", "fee"):
                    r.cardholder = holder
                    r.extra["card_last4"] = card
            monies = [m for m in MONEY_RE.finditer(line)]
            stated: dict[str, int] = {}
            for m in monies:
                ccy = "USD" if m.start() >= (usd_off or 0) - 14 else "ARS"
                stated[ccy] = to_minor(m.group(0), ccy, "comma_decimal")
            computed = {
                ccy: -sum(
                    r.amount_minor
                    for r in block_rows
                    if r.currency == ccy and r.kind in ("purchase", "refund", "fee")
                )
                for ccy in ("ARS", "USD")
            }
            ok = all(stated.get(c) is None or stated[c] == computed[c] for c in ("ARS", "USD"))
            blocks.append(
                {"card": card, "holder": holder, "stated": stated, "computed": computed, "ok": ok}
            )
            if not ok:
                warnings.append(
                    f"card {card} block total mismatch: stated={stated} computed={computed}"
                )
            block_start = len(rows)
            continue

        monies = list(MONEY_RE.finditer(line))
        # Amounts live in the $ / U$S columns; anything left of them is
        # description content (original USD amount, TC rate, RG percentages).
        col_toks = [m for m in monies if m.end() >= (dollar_off or 0) - 14]
        if not col_toks:
            continue

        if "saldo anterior" in f:
            for m in col_toks:
                ccy = "USD" if m.start() >= (usd_off or 0) - 14 else "ARS"
                meta[f"saldo_anterior_{ccy.lower()}"] = to_minor(m.group(0), ccy, "comma_decimal")
            continue

        rm = ROW_START_RE.match(stripped)
        if rm:
            if rm.group(1) and rm.group(2):
                # Months appear full ("Julio") or abbreviated ("Noviem.", "Setiem.")
                mname = fold(rm.group(2)).rstrip(".")
                matched = [v for k, v in MONTHS.items() if k.startswith(mname)]
                if len(set(matched)) != 1:
                    continue  # not a transaction row after all
                year, month = 2000 + int(rm.group(1)), matched[0]
            if year is None or month is None:
                warnings.append(f"row before any dated row: {stripped[:60]}")
                continue
            day = int(rm.group(3))
            rest = normalize_text(line[rm.end() : col_toks[0].start()])
        elif COMPROBANTE_START_RE.match(stripped) and day is not None:
            rest = normalize_text(
                line[: col_toks[0].start()]
            )  # comprobante-first row inherits the full previous date
        else:
            continue
        if year is None or month is None or day is None:
            continue
        date = f"{year:04d}-{month:02d}-{day:02d}"

        comprobante = None
        cm = re.match(r"^(\d{6})\s*(?:[A-Z*]\s+)?(.*)$", rest)
        if cm:
            comprobante, desc = cm.group(1), cm.group(2)
        else:
            desc = rest
        desc = normalize_text(desc)
        if not desc:
            continue

        for m in col_toks:
            ccy = "USD" if m.start() >= (usd_off or 0) - 14 else "ARS"
            statement_amount = to_minor(m.group(0), ccy, "comma_decimal")
            kind = _kind(desc)
            if kind == "purchase" and statement_amount < 0:
                kind = "refund"
            rows.append(
                Row(
                    date=date,
                    description=desc,
                    amount_minor=-statement_amount,  # normalized: money out < 0
                    currency=ccy,
                    kind=kind,
                    source_id=comprobante,
                    extra={},
                    raw=line.rstrip(),
                )
            )

    st = Statement(
        source="santander_visa",
        source_file=rel,
        file_sha256=sha256_file(path),
        account_hint={
            "name": "Santander Visa (ARS+USD)",
            "type": "credit_card",
            "currency": None,
            "note": "one app card account per currency present in rows",
        },
        rows=rows,
        meta=meta,
        validation={
            "card_blocks": blocks,
            "block_mismatches": sum(1 for b in blocks if not b["ok"]),
        },
        warnings=warnings,
    )
    if not rows:
        st.warnings.append("no transaction rows parsed")
    return st
