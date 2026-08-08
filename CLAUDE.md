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
- **Phase 1.5 bank imports — EXTRACTION DONE on the Windows machine.** `scripts/extract/` (Python stdlib + `pdftotext`) parses `BANCOS/` (gitignored) into normalized JSON at `data/imports/extracted/` (gitignored, synced via the Drive share at `/mnt/drive/Stuff/Code/07_money-maker` — copied to this machine already): 58 statements, 2,273 rows, 2023-12→2026-08, ARS/EUR/PYG/USD, all validated arithmetically. JSON contract: `scripts/extract/README.md`.
- **Phase 1.5 app side COMPLETE (2026-08-08):** migration 0002 (`import_batches`, `category_rules` incl. server_seq trigger, `transactions.original_amount/original_currency`); import engine `src/lib/import/` (zod contract, kind→type mapping, dedupe, transfer-leg matching, accent-insensitive rules — all 2,273 real rows parse clean); `/import` UI + actions (preview→dedupe→categorize→commit, idempotent via `onConflictDoNothing` on the partial (account_id, source_hash) index, batch undo clears source_hash so re-import works, household-wide `matchUnlinkedTransfers` sweep); `/settings/categories` UI + `category_rules` management + seed rules at household creation; `scripts/backfill-fx.ts` (`npm run fx:backfill -- --dry-run` works; frankfurter EUR→USD, BCRA composed for ARS, fxratesapi for PYG — BCP is Cloudflare-403). Verified: lint, typecheck, tests (80), build. STILL not tested against a live database.
- Note: cross-currency exchange legs (Revolut/Wise) only auto-link within one statement file; the DB-side sweep is same-currency only (kind isn't persisted). In practice transfer legs pair across files — link remaining ones manually or extend later.
- **Server setup: partially done.** Tailscale host `docker` (Debian 13) reachable; automated writes to it are blocked by the permission classifier, so run `bash scripts/server-setup.sh` from this machine (creates `/opt/money-maker/.env` with generated secrets + installs the GitHub runner via `gh`), then fill `TS_AUTHKEY` (Tailscale admin console) into the server's `.env`. Tailnet: `peacock-snapper.ts.net`. After that, push-to-main deploys; then run the FX backfill against the live DB and do the first real import at `https://money-maker.peacock-snapper.ts.net/import`.
- Known nit: deploy.yaml is not gated on ci.yaml passing (they run in parallel on push to main).
