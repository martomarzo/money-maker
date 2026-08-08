"""Revolut account statement CSV (en-US export, all history in one file).

Header: Type,Product,Started Date,Completed Date,Description,Amount,Fee,
Currency,State,Balance

Amount excludes Fee; Balance reflects Amount - Fee. No stable row ids.
'Exchange' rows are conversions between the user's own currency pockets.
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

from common import Row, Statement, normalize_text, read_text_guess, sha256_file, to_minor

TYPE_KIND = {
    "CARD_PAYMENT": "purchase",
    "CARD PAYMENT": "purchase",
    "FEE": "fee",
    "EXCHANGE": "exchange",
    "TRANSFER": "transfer",
    "DEPOSIT": "income",
    "TOPUP": "transfer",
    "ATM": "purchase",
    "CARD_REFUND": "refund",
    "CARD REFUND": "refund",
    "REFUND": "refund",
    "CASHBACK": "income",
    "CHARGE": "purchase",
    "REWARD": "income",
}

EXPECTED_HEADER = "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance"


def detect(path: Path, content: str | None = None) -> float:
    if path.suffix.lower() != ".csv":
        return 0.0
    content = content or read_text_guess(path)
    return 1.0 if content.lstrip().startswith(EXPECTED_HEADER) else 0.0


def parse(path: Path, rel: str) -> Statement:
    content = read_text_guess(path)
    reader = csv.DictReader(io.StringIO(content))
    rows: list[Row] = []
    currencies: set[str] = set()
    skipped_incomplete = 0

    for rec in reader:
        state = (rec["State"] or "").strip().upper()
        if state != "COMPLETED":
            skipped_incomplete += 1
            continue
        currency = rec["Currency"].strip().upper()
        currencies.add(currency)
        amount = to_minor(rec["Amount"], currency, "dot_decimal")
        fee = to_minor(rec["Fee"] or "0", currency, "dot_decimal")
        # Started Date = when the spend actually happened; date part only.
        date = rec["Started Date"].strip().split(" ")[0]
        desc = normalize_text(rec["Description"])
        rtype = (rec["Type"] or "").strip().upper()
        kind = TYPE_KIND.get(rtype, "unknown")
        balance = (
            to_minor(rec["Balance"], currency, "dot_decimal") if rec.get("Balance") else None
        )

        extra = {"type": rec["Type"], "completed": rec["Completed Date"]}
        if fee:
            extra["fee_minor"] = fee

        rows.append(
            Row(
                date=date,
                description=desc,
                amount_minor=amount,
                currency=currency,
                kind=kind,
                balance_minor=balance,
                extra=extra,
                raw=",".join((rec.get(k) or "") for k in reader.fieldnames or []),
            )
        )
        # Wise/most banks fold fees into separate rows; Revolut has a Fee
        # column. Emit it as its own fee row so nothing is silently lost.
        if fee:
            rows.append(
                Row(
                    date=date,
                    description=f"Fee: {desc}",
                    amount_minor=-abs(fee),
                    currency=currency,
                    kind="fee",
                    extra={"fee_of": desc},
                    raw="",
                )
            )

    st = Statement(
        source="revolut",
        source_file=rel,
        file_sha256=sha256_file(path),
        account_hint={
            "name": f"Revolut {'/'.join(sorted(currencies))}",
            "type": "checking",
            "currency": sorted(currencies)[0] if len(currencies) == 1 else None,
        },
        rows=rows,
        meta={"skipped_non_completed": skipped_incomplete},
    )

    # Balance chain: balance_n = balance_{n-1} + amount - fee. Fee rows we
    # synthesized carry no balance; skip them in the walk.
    mismatches = checked = 0
    prev = None
    for r in rows:
        if r.balance_minor is None:
            continue
        checked += 1
        expected = None
        if prev is not None:
            expected = prev + r.amount_minor + r.extra.get("fee_minor", 0) * 0
            # fee already reduces balance: balance = prev + amount - |fee|
            expected = prev + r.amount_minor - abs(r.extra.get("fee_minor", 0))
        if expected is not None and expected != r.balance_minor:
            mismatches += 1
        prev = r.balance_minor
    st.validation = {
        "balance_chain_checked": checked,
        "balance_chain_mismatches": mismatches,
    }
    if mismatches:
        st.warnings.append(f"{mismatches} running-balance mismatches")
    return st
