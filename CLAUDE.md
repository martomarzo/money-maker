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
- **Phase 1 mostly complete**: FX module (`src/lib/fx/`, boot+daily refresh via `src/instrumentation.ts`), visibility-aware queries (`src/lib/queries.ts`), account+transaction actions, accounts UI. **Transactions UI (list/filters/forms) may still be landing** — check `src/app/(app)/transactions/` exists; if missing, build it per plan Phase 1.
- **Server setup not done yet** (see README Deployment): self-hosted runner on the docker host, `/opt/money-maker/.env`, one-time `TS_AUTHKEY`.
- **Next: Phase 1.5 bank imports.** The user has export files from **Revolut, Wise, Itaú Paraguay, Santander Argentina**. They should be placed in `data/imports/` (gitignored — NEVER commit real bank data). When files are present: inspect real headers/formats first, then build `src/lib/import/` — generic engine + per-bank declarative profiles (column map, date format, decimal style, Débito/Crédito columns), CSV + XLSX, preview→dedupe→commit. Schema is ready: `transactions.source_hash` (unique per account, partial index) + `import_batch_id`.
- Known nit: deploy.yaml is not gated on ci.yaml passing (they run in parallel on push to main).
