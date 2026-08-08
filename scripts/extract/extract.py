"""Extract all statements in BANCOS/ into normalized JSON.

Usage:  python scripts/extract/extract.py [--only wise,revolut,...]

Reads  BANCOS/**  (real bank exports, gitignored)
Writes data/imports/extracted/<source>__<file>.json  (gitignored)
       data/imports/extracted/summary.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import itau  # noqa: E402
import revolut  # noqa: E402
import santander_account  # noqa: E402
import santander_visa  # noqa: E402
import wise  # noqa: E402
from common import Statement, write_statement  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
BANCOS = REPO / "BANCOS"
OUT = REPO / "data" / "imports" / "extracted"

PARSERS = {
    "wise": wise,
    "revolut": revolut,
    "itau_card": itau,
    "santander_account": santander_account,
    "santander_visa": santander_visa,
}


def detect_parser(path: Path):
    best, best_score = None, 0.0
    for name, mod in PARSERS.items():
        try:
            score = mod.detect(path)
        except Exception:
            score = 0.0
        if score > best_score:
            best, best_score = name, score
    return best


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated parser names")
    args = ap.parse_args()
    only = set(args.only.split(",")) if args.only else None

    files = sorted(p for p in BANCOS.rglob("*") if p.is_file())
    summary = {"statements": [], "unrecognized": [], "errors": []}

    for path in files:
        rel = str(path.relative_to(BANCOS)).replace("\\", "/")
        name = detect_parser(path)
        if name is None:
            summary["unrecognized"].append(rel)
            continue
        if only and name not in only:
            continue
        try:
            st: Statement = PARSERS[name].parse(path, rel)
            out = write_statement(st, OUT)
            dates = [r.date for r in st.rows]
            entry = {
                "file": rel,
                "source": name,
                "out": out.name,
                "rows": len(st.rows),
                "date_range": [min(dates), max(dates)] if dates else None,
                "currencies": sorted({r.currency for r in st.rows}),
                "validation": st.validation,
                "warnings": st.warnings,
            }
            summary["statements"].append(entry)
            flag = " !! " + "; ".join(st.warnings) if st.warnings else ""
            print(f"[{name}] {rel}: {len(st.rows)} rows {entry['date_range']}{flag}")
        except Exception as e:  # keep going; report at the end
            summary["errors"].append({"file": rel, "parser": name, "error": repr(e)})
            print(f"[{name}] {rel}: ERROR {e!r}")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    total = sum(s["rows"] for s in summary["statements"])
    print(
        f"\n{len(summary['statements'])} statements, {total} rows, "
        f"{len(summary['errors'])} errors, {len(summary['unrecognized'])} unrecognized"
    )
    return 1 if summary["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
