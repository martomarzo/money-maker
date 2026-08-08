"""Itaú Paraguay credit-card statement — an HTML fragment shipped as `.xls`.

Layout (verified against real 2026 files):
  header divs: nombre tarjeta / cierre al / vencimiento / pago mínimo / deuda total
  one <table>:
    <h4> section rows: Pagos | Compras y cargos realizados en el exterior |
                       Compras y cargos realizados en Paraguay
    data rows: fec. operación | fec. proceso | nº cupón | detalle | monto (PYG)
    'Subtotal (consumo - pagos)' row per cardholder block
    'adicional: <last4> <NAME>' row starts the additional cardholder's block

Statement sign convention: charges positive, payments/credits negative.
Normalized convention: negative = money out — so amounts are NEGATED here.
All amounts are PYG (foreign purchases arrive pre-converted by Itaú).
"""

from __future__ import annotations

import re
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

from common import Row, Statement, fold, normalize_text, read_text_guess, sha256_file, to_minor

DATE_RE = re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$")

META_RE = re.compile(
    r"nombre tarjeta:\s*(?P<card>.+?)\s*cierre al:\s*(?P<cierre>[\d/]+)\s*"
    r"vencimiento:\s*(?P<venc>[\d/]+)\s*pago m.nimo:\s*(?P<minimo>[-\d.,]+)\s*"
    r"deuda total:\s*(?P<deuda>[-\d.,]+)",
    re.DOTALL,
)


class _TableWalker(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._cells: list[str] | None = None
        self._buf: list[str] | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "tr":
            self._cells = []
        elif tag in ("td", "th") and self._cells is not None:
            self._buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._buf is not None and self._cells is not None:
            self._cells.append(normalize_text("".join(self._buf)))
            self._buf = None
        elif tag == "tr" and self._cells is not None:
            if any(c for c in self._cells):
                self.rows.append(self._cells)
            self._cells = None

    def handle_data(self, data: str) -> None:
        if self._buf is not None:
            self._buf.append(data)


def _iso(d: str) -> str:
    return datetime.strptime(d, "%d/%m/%Y").date().isoformat()


def detect(path: Path, content: str | None = None) -> float:
    if path.suffix.lower() not in (".xls", ".html", ".htm"):
        return 0.0
    content = content or read_text_guess(path)
    head = content[:400]
    return 1.0 if "tarjeta de cr" in fold(head) and head.lstrip().startswith("<") else 0.0


def _classify(section: str, description: str, amount_statement: int) -> str:
    d = fold(description)
    if section == "pagos" or "su pago" in d:
        return "payment"
    if "iva ley" in d or d.startswith("iva "):
        return "tax"
    if "cuota anual" in d or "seg.de canc" in d or "seguro" in d:
        return "fee"
    if amount_statement < 0:
        return "refund"  # credits inside a compras section (reversals, discounts)
    return "purchase"


def parse(path: Path, rel: str) -> Statement:
    content = read_text_guess(path)
    text = normalize_text(re.sub(r"<[^>]+>", " ", content).replace("&nbsp;", " "))
    meta_m = META_RE.search(text)
    meta: dict = {}
    if meta_m:
        meta = {
            "card_name": meta_m["card"],
            "cierre": _iso(meta_m["cierre"]),
            "vencimiento": _iso(meta_m["venc"]),
            "pago_minimo_pyg": to_minor(meta_m["minimo"], "PYG", "pyg"),
            "deuda_total_pyg": to_minor(meta_m["deuda"], "PYG", "pyg"),
        }

    walker = _TableWalker()
    walker.feed(content)

    rows: list[Row] = []
    section = ""
    cardholder = "titular"
    subtotals: list[dict] = []
    block_consumo = 0  # running sum of statement-sign compras amounts per block

    for cells in walker.rows:
        joined = " ".join(cells).strip()
        fj = fold(joined)

        if fj.startswith("adicional:"):
            m = re.match(r"adicional:\s*\d*\s*(.+)", joined, re.IGNORECASE)
            cardholder = normalize_text(m.group(1)) if m else "adicional"
            block_consumo = 0
            continue
        if "subtotal" in fj:
            nums = re.findall(r"-?[\d.]{2,}", joined)
            if nums:
                subtotals.append(
                    {
                        "cardholder": cardholder,
                        "stated": to_minor(nums[-1], "PYG", "pyg"),
                        "computed": block_consumo,
                    }
                )
            continue
        if len(cells) == 1 or (cells and not DATE_RE.match(cells[0])):
            # section header (h4 row) or table header row
            if "pagos" == fj:
                section = "pagos"
            elif "exterior" in fj:
                section = "exterior"
            elif "paraguay" in fj:
                section = "paraguay"
            continue
        if len(cells) < 5:
            continue

        op_date, proc_date, cupon, detalle, monto_s = cells[:5]
        if not DATE_RE.match(op_date):
            continue
        monto = to_minor(monto_s, "PYG", "pyg")  # statement sign: charge > 0
        if section in ("exterior", "paraguay"):
            block_consumo += monto
        kind = _classify(section, detalle, monto)
        rows.append(
            Row(
                date=_iso(op_date),
                description=normalize_text(detalle),
                amount_minor=-monto,  # normalized: money out < 0
                currency="PYG",
                kind=kind,
                cardholder=cardholder,
                place=section if section in ("exterior", "paraguay") else None,
                source_id=cupon or None,
                extra={"fecha_proceso": _iso(proc_date) if DATE_RE.match(proc_date) else proc_date},
                raw=" | ".join(cells),
            )
        )

    st = Statement(
        source="itau_card",
        source_file=rel,
        file_sha256=sha256_file(path),
        account_hint={
            "name": meta.get("card_name", "Itaú credit card"),
            "type": "credit_card",
            "currency": "PYG",
        },
        rows=rows,
        meta=meta,
    )
    mismatched = [s for s in subtotals if s["stated"] != s["computed"]]
    st.validation = {
        "subtotals_checked": len(subtotals),
        "subtotal_mismatches": len(mismatched),
        "subtotals": subtotals,
    }
    if mismatched:
        st.warnings.append(f"{len(mismatched)} block subtotal mismatches: {mismatched}")
    if not rows:
        st.warnings.append("no transaction rows parsed")
    return st
