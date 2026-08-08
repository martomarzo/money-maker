@AGENTS.md

# Project instructions (Money Maker)

- **Never add a Claude/AI co-author trailer or attribution to git commits in this repo.** Plain commit messages only.
- `plan.md` is the source of truth for design; keep it updated when decisions change.
- Money is integer minor units ("cents") in app code (`src/lib/domain/money.ts`), `numeric(14,2)` strings at the DB/API boundary. PYG has zero decimals.
- Transfer transactions are two linked rows (`transfer_peer_id`); transfer legs have SIGNED amounts (negative = outflow), expense/income are always positive.
- `server_seq` on sync-tracked tables is stamped by a DB trigger (migration 0001) — never set it in app code.

## Session status (update this section at every good stopping point)

_Last updated: 2026-08-08_

- **Phase 0 complete** (scaffold, schema+migrations, auth/household/invite flow, Docker+Tailscale compose, CI+deploy workflows, money tests). Verified: lint, typecheck, tests, build.
- **Phase 1 complete**: FX module (`src/lib/fx/`, boot+daily refresh via `src/instrumentation.ts`), visibility-aware queries (`src/lib/queries.ts`), account+transaction actions, accounts UI, transactions UI (list with filters + per-currency/base summaries, add/edit forms incl. cross-currency transfers). Verified: lint, typecheck, tests, build. NOT yet tested against a live database — first end-to-end run happens on deploy (or local Postgres).
- **Server setup not done yet** (see README Deployment): self-hosted runner on the docker host, `/opt/money-maker/.env`, one-time `TS_AUTHKEY`.
- **Phase 1.5 bank imports — EXTRACTION DONE on the Windows machine (no Node there).** `scripts/extract/` (Python stdlib + Git's bundled `pdftotext`) parses everything in `BANCOS/` (gitignored) into normalized JSON at `data/imports/extracted/` (gitignored): **58 statements, 2,273 rows, 2023-12→2026-08, ARS/EUR/PYG/USD, zero errors, zero warnings — every parser validated arithmetically** (balance chains for Revolut/Wise/Santander cuenta, stated subtotals for Itaú blocks and Santander Visa per-card totals). See `scripts/extract/README.md` for the JSON contract (dedupe_key, kinds, sign conventions, multi-currency mapping).
- **Next (on the Node machine): app-side import.** (1) Migration 0002: `import_batches`, `category_rules`, `transactions.original_amount/original_currency`. (2) A single "normalized JSON" import adapter in `src/lib/import/` that ingests `data/imports/extracted/*.json` (the Python extractors already did the per-bank parsing; TS re-parsers can come later for in-app upload). (3) `/import` UI: preview→dedupe (`extra.dedupe_key` → `source_hash`)→categorize (rules)→commit; transfer-leg matching across accounts (kinds transfer/exchange/payment, same |amount| ±3 days). (4) Categories management UI. (5) FX historical backfill script (frankfurter EUR/USD, BCRA ARS, BCP PYG) for 2023-12→today.
- The extracted JSON travels with the Google Drive share (`data/imports/` is gitignored but synced) — no need to re-run extraction on the other machine.
- Known nit: deploy.yaml is not gated on ci.yaml passing (they run in parallel on push to main).
