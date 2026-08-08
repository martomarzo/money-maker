"""Wise per-currency balance statement CSV.

Observed header (2026): "TransferWise ID",Date,"Date Time",Amount,Currency,
Description,"Payment Reference","Running Balance","Exchange From","Exchange To",
"Exchange Rate","Payer Name","Payee Name","Payee Account Number",Merchant,
"Card Last Four Digits","Card Holder Full Name",Attachment,Note,"Total fees",
"Exchange To Amount","Transaction Type","Transaction Details Type"

Rows are newest-first. FEE-* rows are Wise's own charges, linked to their
parent by id suffix. Card rows made in a foreign currency say
"Card transaction of 10.70 GBP issued by ..." -> original amount/currency.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from pathlib import Path

from common import Row, Statement, normalize_text, read_text_guess, sha256_file, to_minor

CARD_ORIG_RE = re.compile(r"Card transaction of ([\d.,]+) ([A-Z]{3})")

DETAILS_KIND = {
    "TRANSFER": "transfer",
    "CARD": "purchase",
    "CONVERSION": "exchange",
    "DEPOSIT": "income",
    "MONEY_ADDED": "income",
    "DIRECT_DEBIT": "purchase",
    "UNKNOWN": "unknown",
}


def detect(path: Path, content: str | None = None) -> float:
    if path.suffix.lower() != ".csv":
        return 0.0
    content = content or read_text_guess(path)
    return 1.0 if content.lstrip().startswith('"TransferWise ID"') else 0.0


def parse(path: Path, rel: str) -> Statement:
    content = read_text_guess(path)
    reader = csv.DictReader(io.StringIO(content))
    rows: list[Row] = []
    currencies: set[str] = set()

    for rec in reader:
        twid = rec["TransferWise ID"].strip()
        currency = rec["Currency"].strip().upper()
        currencies.add(currency)
        amount = to_minor(rec["Amount"], currency, "dot_decimal")
        date = datetime.strptime(rec["Date"], "%d-%m-%Y").date().isoformat()
        desc = normalize_text(rec["Description"])
        merchant = normalize_text(rec.get("Merchant") or "") or None

        if twid.startswith("FEE-"):
            kind = "fee"
        else:
            kind = DETAILS_KIND.get(
                (rec.get("Transaction Details Type") or "UNKNOWN").strip().upper(),
                "unknown",
            )
        # A CONVERSION credit/debit is an exchange leg either way; a TRANSFER
        # received (positive) is income-ish but stays 'transfer' — the app's
        # preview decides using counterparty matching.

        orig_amount = orig_ccy = None
        m = CARD_ORIG_RE.search(desc)
        if m:
            orig_ccy = m.group(2)
            orig_amount = to_minor(m.group(1), orig_ccy, "dot_decimal")
            if amount < 0 and orig_amount > 0:
                orig_amount = -orig_amount

        balance = None
        if rec.get("Running Balance"):
            balance = to_minor(rec["Running Balance"], currency, "dot_decimal")

        extra = {
            k: v
            for k, v in {
                "payment_reference": rec.get("Payment Reference"),
                "payer_name": rec.get("Payer Name"),
                "payee_name": rec.get("Payee Name"),
                "exchange_from": rec.get("Exchange From"),
                "exchange_to": rec.get("Exchange To"),
                "exchange_rate": rec.get("Exchange Rate"),
                "exchange_to_amount": rec.get("Exchange To Amount"),
                "total_fees": rec.get("Total fees"),
                "card_last_four": rec.get("Card Last Four Digits"),
                "card_holder": rec.get("Card Holder Full Name"),
                "note": rec.get("Note"),
                "details_type": rec.get("Transaction Details Type"),
            }.items()
            if v
        }

        rows.append(
            Row(
                date=date,
                description=desc,
                amount_minor=amount,
                currency=currency,
                kind=kind,
                merchant=merchant,
                original_amount_minor=orig_amount,
                original_currency=orig_ccy,
                source_id=twid,
                balance_minor=balance,
                extra=extra,
                raw=",".join((rec.get(k) or "") for k in reader.fieldnames or []),
            )
        )

    rows.reverse()  # oldest first

    st = Statement(
        source="wise",
        source_file=rel,
        file_sha256=sha256_file(path),
        account_hint={
            "name": f"Wise {'/'.join(sorted(currencies))}",
            "type": "checking",
            "currency": sorted(currencies)[0] if len(currencies) == 1 else None,
        },
        rows=rows,
    )

    # Validate the running balance chain (rows now oldest->newest).
    mismatches = 0
    prev = None
    for r in rows:
        if r.balance_minor is None:
            continue
        if prev is not None and prev + r.amount_minor != r.balance_minor:
            mismatches += 1
        prev = r.balance_minor
    st.validation = {
        "balance_chain_checked": sum(1 for r in rows if r.balance_minor is not None),
        "balance_chain_mismatches": mismatches,
    }
    if mismatches:
        st.warnings.append(
            f"{mismatches} running-balance mismatches — rows may be missing or misordered"
        )
    return st
