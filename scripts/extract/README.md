# BANCOS statement extraction

Standalone Python 3.11+ pipeline (stdlib only) that parses the real bank
exports in `BANCOS/` (gitignored) into normalized JSON the app's import
engine ingests directly. Built to run without Node — `pdftotext` (bundled
with Git for Windows, Xpdf build) handles the Santander PDFs.

```bash
python scripts/extract/extract.py            # everything
python scripts/extract/extract.py --only wise,itau_card
```

Output: `data/imports/extracted/<source>__<file>.json` + `summary.json`
(both gitignored — they contain real financial data).

## Parsers

| module | source | validation |
|---|---|---|
| `revolut.py` | Revolut CSV (all history, one file) | running Balance chain |
| `wise.py` | Wise per-currency CSV | running Balance chain |
| `itau.py` | Itaú PY card, HTML-as-`.xls`, PYG | per-cardholder block subtotals |
| `santander_account.py` | Santander AR account PDF (`pdftotext -table`), ARS+USD sections | running Saldo chain + section totals |
| `santander_visa.py` | Santander AR Visa resumen PDF, dual `$`/`U$S` columns | per-card "Total Consumos" totals, both currencies |

All validations pass on the current corpus (58 files, 2,273 rows,
2023-12-29 → 2026-08-07). Every parser records the verbatim source line in
`rows[].raw` for audit.

## JSON contract (per statement file)

```jsonc
{
  "source": "itau_card",            // parser id
  "source_file": "Itau/Detalle - enero 2026.xls",
  "file_sha256": "…",
  "account_hint": { "name": "…", "type": "credit_card", "currency": "PYG" },
  "meta": { /* statement-level: cierre, saldo anterior, opening balances… */ },
  "validation": { /* what was checked, all zeros = clean */ },
  "warnings": [],
  "rows": [
    {
      "date": "2025-12-02",          // ISO, operation date
      "description": "…",
      "amount_minor": -661088,       // SIGNED integer minor units; negative = money out
                                     // PYG has 0 decimals, others 2
      "currency": "PYG",
      "kind": "purchase|payment|fee|exchange|transfer|tax|refund|income|unknown",
      "merchant": null,              // Wise only so far
      "original_amount_minor": null, // foreign-currency purchases (Wise card rows)
      "original_currency": null,
      "cardholder": "LASTNAME, FIRSTNAME",  // Itaú/Santander Visa: who spent
      "place": "exterior",           // Itaú: exterior | paraguay
      "source_id": "3232352",        // bank-native id (cupón/comprobante/Wise ID)
      "balance_minor": null,         // running balance where the source has one
      "extra": { "dedupe_key": "sha256…", /* source-specific fields */ },
      "raw": "verbatim source line(s)"
    }
  ]
}
```

Import-engine notes:

- `extra.dedupe_key` is a stable sha256 (bank id when available, else
  date|amount|currency|description|occurrence-index) — use it as
  `transactions.source_hash`.
- `kind` mapping: `transfer`/`exchange`/`payment` rows are candidates for
  transfer-leg matching across accounts (Wise→Santander transfers, card
  payments, Revolut currency exchanges) — do NOT count them as expenses.
- Santander statements yield rows in BOTH ARS and USD from one file — map
  each currency to its own app account.
- Multi-currency Santander Visa: `$` and `U$S` columns are separate card
  accounts (ARS + USD).
- Sign convention is app-native already (expense negative), including for
  credit cards (statement signs were flipped where needed).
