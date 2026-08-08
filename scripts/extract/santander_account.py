"""Santander Argentina monthly account statement PDF ("Mi resumen de cuenta").

Extracted with `pdftotext -table` (Xpdf). Sections "Movimientos en pesos" /
"Movimientos en dólares"; columns (names vary by product/era):

  Fecha  Comprobante  Movimiento  <Caja de Ahorro|Cuenta sueldo>  [Cuenta Corriente]  Saldo en cuenta

Quirks handled here (all observed in real files):
  - Saldo is only printed on some rows; rows in between carry just the
    movement amount. Chain check: prev_saldo + sum(pending) == next saldo.
  - Continuation lines under a movement may themselves contain $ amounts
    ("Resp:... 2,45% sobre $17.000,00") — classified by column offset, not
    by presence of a money token.
  - Page headers repeat mid-section ("Saldo total al dd/mm/yy*", account
    header, totals) and must not end the section; the end markers are
    "Saldo total" (without "al") and "Detalle impositivo".
One PDF feeds two app accounts (ARS + USD); rows carry their own currency.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

from common import Row, Statement, fold, normalize_text, sha256_file, to_minor

PDFTOTEXT = r"C:\Program Files\Git\mingw64\bin\pdftotext.exe"

MONEY_RE = re.compile(r"-?\s?(?:U\$S|\$)\s*[\d.]+,\d{2}")
DATE_RE = re.compile(r"^(\d{2}/\d{2}/\d{2})\b")
FILE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{10,}\.pdf$", re.IGNORECASE)

SECTION_ARS = re.compile(r"Movimientos\s+en pesos")
SECTION_USD = re.compile(r"Movimientos\s+en d")
SECTION_END = re.compile(r"^\s*(Saldo\s+total(?!\s+al)|Detalle impositivo)")
HEADER_RE = re.compile(r"^\s*Fecha\s+Comprobante\s+Movimiento")
COL_RE = re.compile(r"Caja\s+de\s+Ahorro|Cuenta\s+sueldo|Cuenta\s+Corriente")

KIND_RULES = [
    ("pago tarjeta", "transfer"),        # paying the credit card = transfer to card acct
    ("pago de tarjeta", "transfer"),
    ("transferencia", "transfer"),
    ("transf online banking", "transfer"),
    ("traspaso de saldo", "transfer"),
    ("impuesto", "tax"),
    ("iva ", "tax"),
    ("iva 21", "tax"),
    ("percep", "tax"),
    ("sellos", "tax"),
    ("ley 25.413", "tax"),
    ("comision", "fee"),
    ("mantenimiento", "fee"),
    ("cobro de interes", "fee"),
    ("intereses por descubierto", "fee"),
    ("pago interes", "income"),
    ("compra con tarjeta de debito", "purchase"),
    ("extraccion", "purchase"),
    ("debito automatico", "purchase"),
    ("deb. automatico", "purchase"),
    ("credito transf", "transfer"),
    ("acreditacion", "income"),
    ("haberes", "income"),
]


def _kind(description: str, amount: int) -> str:
    d = fold(description)
    for needle, kind in KIND_RULES:
        if needle in d:
            return kind
    return "unknown" if amount >= 0 else "purchase"


def pdf_to_table_text(path: Path) -> str:
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as tmp:
        out = Path(tmp.name)
    try:
        subprocess.run(
            [PDFTOTEXT, "-table", "-enc", "UTF-8", str(path), str(out)],
            check=True,
            capture_output=True,
        )
        return out.read_text(encoding="utf-8", errors="replace")
    finally:
        out.unlink(missing_ok=True)


def detect(path: Path) -> float:
    if path.suffix.lower() != ".pdf":
        return 0.0
    # Account statements are named yyyy-mm-dd_<accountnumber>.pdf
    return 0.9 if FILE_RE.match(path.name) else 0.0


def _iso(d: str) -> str:  # dd/mm/yy -> ISO, pivoting 2000
    dd, mm, yy = d.split("/")
    return f"20{yy}-{mm}-{dd}"


def parse(path: Path, rel: str) -> Statement:
    text = pdf_to_table_text(path)
    lines = text.splitlines()

    rows: list[Row] = []
    meta: dict = {}
    warnings: list[str] = []

    currency: str | None = None
    last_date: str | None = None
    prev_saldo: int | None = None
    pending: int = 0  # movement amounts since the last printed saldo
    first_col_off: int | None = None
    saldo_off: int | None = None
    chain = {"ARS": {"checked": 0, "mismatches": 0}, "USD": {"checked": 0, "mismatches": 0}}

    def flush_section(end_line: str | None = None) -> None:
        """On section end, verify any saldo-less trailing rows against the
        printed 'Saldo total'; without one, surface the leftover as a warning."""
        nonlocal pending
        if pending and currency:
            total = None
            if end_line:
                m = MONEY_RE.search(end_line)
                if m:
                    total = to_minor(m.group(0), currency, "comma_decimal")
            if total is not None and prev_saldo is not None:
                chain[currency]["checked"] += 1
                if prev_saldo + pending != total:
                    chain[currency]["mismatches"] += 1
            else:
                warnings.append(
                    f"{currency}: {pending} minor units pending after last saldo"
                )
        pending = 0

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        if SECTION_ARS.search(stripped) and "ltimos" not in stripped:
            flush_section()
            currency, prev_saldo, last_date = "ARS", None, None
            first_col_off = saldo_off = None
            continue
        if SECTION_USD.search(stripped):
            flush_section()
            currency, prev_saldo, last_date = "USD", None, None
            first_col_off = saldo_off = None
            continue
        if currency is None:
            continue
        if SECTION_END.match(stripped):
            flush_section(stripped)
            currency = None
            continue

        if HEADER_RE.match(line):
            s = line.find("Saldo en cuenta")
            saldo_off = s if s >= 0 else None
            cols = [m.start() for m in COL_RE.finditer(line)]
            first_col_off = min(cols) if cols else None
            continue

        f = fold(stripped)
        if (
            "banco santander" in f
            or "salvo error" in f
            or re.match(r"^\d+ - \d+$", stripped)
            or f.startswith(("cuenta 014", "periodo", "desde:", "hasta:", "mi resumen",
                             "saldo total al", "total en pesos", "total en d"))
        ):
            continue

        if saldo_off is None:
            continue  # can't classify without a header yet

        monies = list(MONEY_RE.finditer(line))
        fco = first_col_off if first_col_off is not None else saldo_off - 40
        # The saldo, when printed, is always the last (rightmost) token; any
        # token before it in the amount-column region is a movement amount.
        saldo_toks: list[re.Match] = []
        move_candidates = monies
        if monies and monies[-1].start() >= saldo_off - 12:
            saldo_toks = [monies[-1]]
            move_candidates = monies[:-1]
        move_toks = [m for m in move_candidates if m.end() >= fco - 8]

        if not saldo_toks and not move_toks:
            if rows and rows[-1].currency == currency:
                rows[-1].description += f" / {normalize_text(stripped)}"
                rows[-1].raw += f"\n{line.rstrip()}"
            continue

        first_tok = min((m.start() for m in saldo_toks + move_toks))
        desc = normalize_text(line[:first_tok])
        datem = DATE_RE.match(stripped)
        if datem:
            desc = normalize_text(desc[len(datem.group(1)):] if desc.startswith(datem.group(1)) else desc)
            last_date = _iso(datem.group(1))
        cm = re.match(r"^(\d{5,})\s+(.*)$", desc)
        comprobante = None
        if cm:
            comprobante, desc = cm.group(1), cm.group(2)

        if not datem and not desc:
            continue  # stray totals fragment

        amounts = [to_minor(m.group(0), currency, "comma_decimal") for m in move_toks]
        saldo = to_minor(saldo_toks[-1].group(0), currency, "comma_decimal") if saldo_toks else None
        amount = sum(amounts)

        if fold(desc).startswith("saldo inicial"):
            if saldo is not None:
                meta[f"opening_balance_{currency.lower()}"] = saldo
                meta.setdefault("opening_date", last_date)
                prev_saldo = saldo
            continue

        if saldo is not None:
            if prev_saldo is not None:
                chain[currency]["checked"] += 1
                if prev_saldo + pending + amount != saldo:
                    chain[currency]["mismatches"] += 1
            prev_saldo = saldo
            pending = 0
        else:
            pending += amount

        if not amounts:
            warnings.append(f"saldo with no movement amount: {stripped[:70]}")
            continue

        rows.append(
            Row(
                date=last_date or "",
                description=desc,
                amount_minor=amount,
                currency=currency,
                kind=_kind(desc, amount),
                source_id=comprobante,
                balance_minor=saldo,
                raw=line.rstrip(),
            )
        )

    undated = [r for r in rows if not r.date]
    if undated:
        warnings.append(f"{len(undated)} rows without a date")
    for ccy, c in chain.items():
        if c["mismatches"]:
            warnings.append(f"{ccy}: {c['mismatches']}/{c['checked']} saldo-chain mismatches")

    return Statement(
        source="santander_account",
        source_file=rel,
        file_sha256=sha256_file(path),
        account_hint={
            "name": "Santander cuenta (ARS+USD)",
            "type": "checking",
            "currency": None,
            "note": "one app account per currency present in rows",
        },
        rows=rows,
        meta=meta,
        validation={"saldo_chain": chain},
        warnings=warnings,
    )
