# Money Maker — Household Finance App

A multi-user, offline-first PWA for tracking expenses, budgets, accounts, and cards across multiple currencies, shared between you and your partner.

## 1. Goals

- Track expenses (and income) across multiple accounts and cards in different countries/currencies.
- Log expenses **offline** from a phone; sync automatically when back online.
- Two-person household: each partner has **personal** accounts/expenses plus a **shared** household space.
- Budgets per category, per month, with converted totals in a **base currency**.
- Runs anywhere: Dockerized so it can live on a home server, VPS, or cloud later.

### Non-goals (v1)

- Bank integrations / automatic transaction import (manual + CSV import only).
- Investment tracking, net-worth history, debt payoff planning.
- More than one household, or households with >2–3 members (design shouldn't prevent it, but no UI effort).
- Native mobile apps — the PWA is the mobile app.

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript | PWA via `next-pwa`/Serwist (Workbox-based) |
| UI | Tailwind CSS + shadcn/ui | Fast to build, good mobile ergonomics |
| Client storage | IndexedDB via Dexie.js | Offline transaction queue + local cache |
| API | Next.js Route Handlers (REST) | Single deployable; no separate API server |
| ORM | Drizzle ORM | Type-safe, SQL-first, great migration story |
| Database | PostgreSQL 16 | |
| Auth | Auth.js (NextAuth v5), credentials + optional Google | Session cookies (httpOnly) |
| FX rates | open.er-api.com (free, no key, 160+ currencies incl. ARS/PYG) | Daily cron; rates cached in our DB |
| Deploy | Docker Compose (app + postgres + tailscale) | Home docker host; Tailscale sidecar exposes the app via `tailscale serve` (tailnet-only HTTPS) |
| CI/CD | GitHub Actions: lint, typecheck, test (GitHub-hosted) + deploy job on a self-hosted runner on the docker host | Every push to `main` deploys |

**Why not Supabase/PocketBase:** offline sync is custom work either way; owning the schema and API keeps the sync protocol simple and the whole thing portable (one `docker compose up`).

## 3. Core concepts & data model

### Entities

```
User          — login identity (email, password hash, display name, avatar)
Household     — the shared space; has a base_currency (e.g. EUR)
Membership    — user ↔ household, role (owner | member)
Account       — belongs to household; has owner_user_id (NULL = shared/joint)
                fields: name, type (checking | savings | cash | credit_card),
                currency, country, initial_balance, archived
Category      — household-scoped, tree (parent_id) e.g. Food > Groceries;
                seeded defaults, user-editable; scope: shared | personal
Transaction   — the heart of the app
Budget        — category + month + amount + currency (base or native)
FxRate        — (date, from_currency, to_currency, rate) cache table
```

### Transaction

```
id              uuid (client-generated — required for offline sync)
household_id    fk
account_id      fk            → determines native currency
created_by      fk user
type            expense | income | transfer
amount          numeric(14,2) in the account's currency (always positive; type gives sign)
currency        char(3)       denormalized from account for safety
date            date          (user-chosen, not created_at)
category_id     fk nullable
payee           text nullable
notes           text nullable
visibility      shared | personal   (personal = only creator sees it)
transfer_peer_id uuid nullable      (links the two legs of a transfer)
fx_rate_to_base numeric nullable    (rate snapshotted on the transaction date)
created_at / updated_at / deleted_at (soft delete — required for sync)
```

Rules:
- **Amounts are stored in the account's native currency, forever.** Conversion to base currency happens at read time using the snapshotted `fx_rate_to_base` (filled by the server when the rate is known; backfilled by the FX cron for offline-created transactions).
- **Transfers** between accounts (possibly cross-currency) are two linked transaction rows; neither counts as expense/income in reports.
- **Credit cards** are just accounts with negative-trending balances; paying the card is a transfer.

### Personal vs shared

- Accounts with `owner_user_id = NULL` are joint — both partners see them and their transactions.
- Personal accounts are visible only to their owner, **except** transactions on them marked `visibility: shared` also appear in household reports/budgets (e.g. "I paid the plumber from my personal card, but it's a household expense").
- Budgets live at household level; a "personal budgets" view filters to your own stuff.

## 4. Offline-first sync

This is the riskiest part, so the design is deliberately boring:

### Strategy: client-generated IDs + push queue + pull-since-cursor

1. **Reads:** the client keeps a full local cache of the household's data (transactions for the last N months + all accounts/categories/budgets) in IndexedDB. The UI always renders from IndexedDB — network state never blocks the UI.
2. **Writes:** every mutation (create/edit/delete transaction, etc.) is written to IndexedDB immediately and appended to an **outbox queue**. A sync worker flushes the outbox whenever online (on reconnect, on app focus, via Background Sync API where supported).
3. **Push:** `POST /api/sync/push` takes a batch of mutations. Idempotent: transaction UUIDs are generated on the client, so retries can't duplicate. Server applies, stamps `updated_at`, returns authoritative rows.
4. **Pull:** `GET /api/sync/pull?since=<cursor>` returns all rows changed after the cursor (using a per-household monotonic `server_seq` on every row, not timestamps — clock skew safe). Client merges into IndexedDB.
5. **Conflicts:** last-write-wins on `updated_at` at the **row** level. With two users this is almost always fine; edits to the same transaction within the same offline window are rare. Deletes are soft (`deleted_at`) so they sync like updates. No CRDTs, no operational transforms.
6. **FX while offline:** transaction saves without a rate; server backfills `fx_rate_to_base` on receipt (or when the day's rate arrives). Converted totals show a subtle "pending rate" state until then.

### PWA specifics

- `manifest.json` (installable, standalone display, icons, theme color).
- Service worker: precache app shell, runtime cache for API GETs (stale-while-revalidate), Background Sync registration for the outbox.
- HTTPS required — the Tailscale sidecar's `tailscale serve` terminates TLS with a valid `*.ts.net` certificate; no Caddy or public certs needed. Both phones run the Tailscale app (tailnet-only access).
- An **"Quick add"** screen optimized for one-handed phone entry (amount → category grid → done) is the primary offline use case; make it the PWA start URL or one tap from it.

## 5. Multi-currency

- Household has a `base_currency` (set at onboarding, changeable — reports just re-derive).
- Each account has a fixed native currency.
- Daily cron (in-app scheduled job) fetches rates from open.er-api.com into `FxRate` (covers USD, EUR, ARS, PYG and 160+ others; no API key needed); rates for the transaction's **date** are used (not today's), so historical reports are stable.
- **ARS caveat:** API rates track the official exchange rate. If you ever need a parallel/market rate for ARS, use the per-transaction manual rate override — no special-casing in the data model.
- Reports show: per-currency subtotals **and** the converted base-currency total (you get both views).
- Manual rate override per transaction (for cases like card FX fees where the real rate differs).

## 6. Feature scope by phase

### Phase 0 — Skeleton (foundation)
- Repo (github.com/martomarzo/money-maker), Next.js + TS + Tailwind, Drizzle + Postgres, Docker Compose (app, postgres, tailscale sidecar).
- CI workflow + deploy workflow (self-hosted runner on the docker host); first deploy reachable at `https://money-maker.<tailnet>.ts.net`.
- Auth (register/login), create household, invite partner via link/code.
- Seed default categories.

### Phase 1 — Core tracking (online-only)
- Accounts & cards CRUD (currency, country, type, initial balance, personal/joint).
- Transactions CRUD: expense, income, transfer; category, payee, notes, visibility.
- Transaction list with filters (account, category, person, date range) + running balances.
- FX rate fetching + base-currency conversion in list totals.

**Milestone: usable as an online expense tracker.**

### Phase 1.5 — Bank history import (pulled forward from Phase 4)

Real history lives in Revolut, Wise, Itaú (Paraguay), and Santander (Argentina) — importing it early makes reports and budgets useful from day one.

**Real formats (inspected 2026-08-08, files in `BANCOS/` — gitignored, never committed):**

| Source | Actual format | Key traits |
|---|---|---|
| Revolut | CSV (one file, all history) | `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance`. ISO datetimes, signed dot-decimal amounts, `Currency` per row. Filter `State=COMPLETED`. No stable row ID → hash. `Exchange` rows are internal currency conversions (transfer legs, not income/expense). |
| Wise | CSV per currency | Rich: stable **`TransferWise ID`** (use as dedupe key directly), `dd-MM-yyyy` dates, signed amounts, `Merchant`, `Exchange From/To/Rate`, `Total fees`, `Transaction Type`. Fees are separate linked `FEE-*` rows → auto-categorize as Fees. Card rows carry the **original foreign amount+currency** ("Card transaction of 10.70 GBP…") — parse it out. |
| Itaú Paraguay | `.xls` that is actually an **HTML fragment** | Credit-card statement, all amounts PYG (dot = thousands, 0 decimals, negative = payment/refund). Header block: card name, `cierre`, `vencimiento`. `<h4>` sections: `Pagos`, `Compras … en el exterior`, `Compras … en Paraguay` — repeated per cardholder (titular + **adicional**, separated by an `adicional: <last4> <NAME>` row). Columns: fec. operación / fec. proceso / nº cupón / detalle / monto. Foreign purchases are pre-converted to PYG (original currency not present). |
| Santander Argentina — account | **PDF** (monthly "Mi resumen de cuenta") | `pdftotext -layout` extracts well. Two sections: `Movimientos en pesos` (ARS) and `Movimientos en dólares` (USD) → two app accounts from one PDF. `1.234,56` decimals, `dd/MM/yy` dates, `Comprobante` number, multi-line descriptions, running `Saldo` column (use to **validate** the parse). |
| Santander Argentina — Visa | **PDF** (resumen de tarjeta) | Hardest: dual `$`/`U$S` columns (→ Visa ARS + Visa USD card accounts), `25 Julio 04` = yy/month-name/dd dates, tax lines (IIBB/IVA percepciones), payments with FX rate. Text extraction is noisy — build last, tolerate manual fallback. |

**Architecture — as built (2026-08-08):** per-bank parsing moved OUT of the app into the standalone Python pipeline `scripts/extract/` (stdlib + `pdftotext`, runs on the Windows machine without Node — see `scripts/extract/README.md`). It emits **normalized JSON** (`data/imports/extracted/*.json`, gitignored, synced via the Drive share) with signed integer minor units, `kind`, `extra.dedupe_key`, and per-parser arithmetic validation (balance chains / stated subtotals) built in. The app side (`src/lib/import/`) is a single **normalized-JSON adapter**: zod contract in `types.ts`, pure engine in `engine.ts` (kind→type mapping, in-batch dedupe, transfer-leg matching, accent-insensitive category-rule suggestions), fs loader in `load.ts`. TS re-parsers for in-app upload of raw bank files can come later; the original per-source adapter sketch below is superseded for v1.

**Schema additions (migration 0002):**

- `import_batches` table: id, household_id, account_id, source, filename, file_sha256, date range, row counts (imported/skipped-dupe/skipped-filtered), created_by, created_at. `transactions.import_batch_id` → FK; enables "undo this import".
- `transactions.original_amount` + `original_currency` (nullable): **never lose what currency a purchase was really made in** — the account leg stays in the account's native currency (schema rule), the original foreign amount is preserved structurally, not in free-text notes.
- `category_rules` table (sync-tracked): household_id, `match_text` (case/accent-insensitive substring on description/merchant), optional account/currency filter, category_id, priority. Applied at import preview time as *suggestions*; user confirms/overrides in preview.

**Categorization (restaurants, services, …):**

- Categories are already household rows (seeded defaults, tree, editable). Add the missing **category management UI** (`/settings/categories`): rename, re-icon, re-parent, add, archive.
- Rules engine: when the user (re)categorizes an imported row in preview, offer "always categorize *MERCADONA* as Groceries" → creates a `category_rule`. Next imports auto-suggest. Ship a small generic merchant seed list (Glovo→Delivery, farmacia→Pharmacy, YouTube/Spotify/HBO→Subscriptions, airlines→Travel, …) as *rules*, so they're editable like everything else.
- Uncertain rows land as `Other` + flagged "needs review" filter in the transactions list.

**Import flow (UI at `/import`):**

1. Upload file(s) → adapter auto-detected (confidence + override dropdown).
2. Map to account(s) — Santander account PDF proposes two (ARS/USD); first import of a source can create the account inline (type/currency prefilled from the file).
3. Preview table: parsed rows, dedupe status (`source_hash` = sha256 of `sourceId ?? date|amount|currency|description|n-th-occurrence`), suggested categories (rules), transfer detection, per-row include/exclude.
4. **Transfer handling:** rows that are movements between own accounts (Revolut `Exchange`, Wise "Sent money to Martin", Santander "Pago tarjeta de crédito", Itaú `SU PAGO`) must NOT count as income/expense. Heuristic marks them `transfer`; matching the two legs across accounts (same |amount|, ±3 days, opposite signs) links them; unmatched ones import as unlinked transfer legs to pair up later.
5. Commit → one `import_batch`, transactions inserted with `source_hash` (DB unique index makes re-imports idempotent), FX backfill queued.

**Historical FX backfill (new problem — history reaches back to 2024):** open.er-api.com free tier has no historical endpoint. Backfill strategy per currency: frankfurter.app (ECB) for EUR/USD history; BCRA's free API for official USD/ARS; BCP Paraguay publishes PYG reference rates. A one-time `scripts/backfill-fx.ts` populates `fx_rates` for the imported date range; anything still missing uses nearest-available rate and is marked approximate (`fx_rate_to_base` still set — reports work).

**Build order:** done — extraction (Python, all five sources, validated) → migration 0002 → engine + tests (synthetic fixtures in `tests/fixtures/import/`; real files stay out of git) → `/import` UI → categories UI → `scripts/backfill-fx.ts` (frankfurter/ECB for EUR→USD, BCRA composed via USD for ARS, fxratesapi.com for PYG — BCP is Cloudflare-walled).

**Milestone: full multi-bank history in the app; reports reflect reality.**

### Phase 1.6 — Dashboard & budgets (pulled forward from Phase 3, planned 2026-08-09)

Decision: with real history imported, the dashboard and budgets deliver more value now than offline support — Phase 3's reporting core moves ahead of the PWA work.

**Dashboard (`/` — replaces the stub):**

- Month selector (default: current month), plus an "all time" option.
- KPI row in base currency: income, expenses, net — with per-currency subtotals underneath and a "pending FX" marker when rates are missing (`summarizeTransactions` already computes all of this).
- **Where it went:** expenses by category, sorted horizontal bars with amount + share; parent categories roll up their children, click-through to the filtered transactions list.
- **Where it came from:** same treatment for income by category.
- Trend: last 12 months, income vs expenses side by side (monthly bars, base currency).
- Account balances snapshot (reuse `listAccountsWithBalances`).
- Implementation: server-computed aggregates in `src/lib/queries.ts` (SQL GROUP BY, visibility rules and transfer-exclusion identical to `listTransactions`); charts are small hand-rolled inline SVG components — no chart dependency for v1.

**Budgets (`/budgets`):** schema already exists (`budgets`: household + category + month + amount + currency, unique per (household, category, month)).

- Month picker; per-category rows: budget input (base currency v1), actual spend that month (same aggregate as the dashboard), progress bar, over-budget highlight.
- Actions: upsert/delete budget, "copy last month" rollover.
- Personal-budget filtered view stays in Phase 3.

Import-review follow-ups from first real use land here too (e.g. "needs review"/uncategorized filter in the transactions list).

### Phase 1.7 — Wallet capture (built 2026-08-19 — SUPERSEDED 2026-08-25, kept as experimental)

Card payments auto-land in the app seconds after the tap. No native apps:
Android forwards Google Wallet/bank notifications via a MacroDroid macro;
iPhone uses the built-in Shortcuts "Transaction" automation (iOS 17+). Both
POST over the tailnet to `POST /api/wallet/capture` (per-device bearer
tokens). Server pipeline (`src/lib/wallet/`): parse → card→account mapping
(`card_key` = last-4 on Android, card name on iOS) → `category_rules`
auto-categorization (reuses `suggestCategory`) → insert expense
(personal-default, cross-currency via `original_amount/original_currency` +
`fx_rates`). `/wallet` inbox: one-tap share, recategorize (+create rule),
assign unknown cards, dismiss noise; `/settings/devices` manages tokens and
mappings. Migration 0003: `wallet_devices`, `wallet_card_mappings`,
`wallet_captures` (raw payload kept; `capture_hash` unique = idempotent
ingest; parse failures land in the inbox, never as wrong transactions).
No reconciliation with statement imports — those were a one-time backfill.
**Full spec: `docs/superpowers/specs/2026-08-19-wallet-capture-design.md`.** Setup guides at `docs/wallet-android-setup.md` / `docs/wallet-ios-setup.md`.

Status: deployed 2026-08-19, but the first real taps **did not arrive** and the
user does not want to depend on configuring a third-party phone automation
(MacroDroid / Shortcuts). Decision 2026-08-25: the endpoint, `/wallet` inbox and
`/settings/devices` stay in the codebase as an *experimental* path (unlinked
from the main nav, labelled as such in-page); no further parser work is
planned. Capture now happens **natively in the app** — see Phase 1.8.

### Phase 1.8 — Native quick capture (started 2026-08-25, priority #1)

Logging an expense must be the fastest thing the app does, with nothing to
configure outside it. Technical reality: a web app cannot read Google Wallet /
bank notifications, so "native" here means the app itself is the capture
surface — one tap from the home screen, one screen to fill, done.

- **Dashboard = capture hub (done 2026-08-25):** `/` opens on a hero with
  **Add expense** as the primary action (plus Add income / Transfer), then
  account balances and the latest transactions. `/transactions/new?type=…`
  preselects the mode. A floating `+` button sits in the mobile tab bar on
  every page and an `Add` button in the desktop header.
- **Installable (done 2026-08-25):** `src/app/manifest.ts` + generated icons
  (`src/app/icon.svg`, `apple-icon.png`, `favicon.ico`, `public/icons/*`),
  theme-color, standalone display — "Add to Home Screen" gives an app icon
  that opens straight onto the capture hub.
- **Next:** a dedicated one-handed quick-add screen (amount keypad → category
  grid → account chip → save; defaults remembered per device) — this is the
  Phase 2 "Quick add" screen pulled forward; then offline queueing in Phase 2
  makes it work without signal.
- **Later, optional:** if true auto-capture is ever wanted, the only path
  that needs no third-party config is a small native Android companion app
  (NotificationListenerService) posting to the existing
  `POST /api/wallet/capture` endpoint — which is why that endpoint stays.

### Visual pass (2026-08-25)

Design tokens live in `src/app/globals.css` (Tailwind v4 `@theme`: warm
neutral surfaces, teal accent, semantic `income`/`expense`/`warning`/`danger`,
light + dark). Shared primitives in `src/components/ui.tsx` (`Button`,
`ButtonLink`, `Card`, `PageHeader`, `Badge`, `EmptyState`, `ErrorText`,
`inputClass`/`labelClass`). App shell in `src/components/app-shell.tsx`:
sticky header with logo mark, desktop nav, mobile bottom tab bar
(Home / Transactions / + / Accounts / Settings). Every page uses the
primitives; no raw `black/white` opacity classes remain.

### Phase 2 — Offline PWA
- IndexedDB cache + outbox, sync push/pull endpoints, service worker, manifest.
- Quick-add screen; offline indicator; sync status/pending badge.
- Install prompts for iOS/Android.

**Milestone: log expenses on the subway; they appear on your partner's device later.**

### Phase 3 — Budgets & reports
- Monthly budgets per category (household + personal views), progress bars, over-budget alerts.
- Reports: spending by category/month/person/account, per-currency + converted, trend charts.
- Month rollover (copy last month's budgets).

### Phase 4 — Quality of life
- Recurring transactions (rent, subscriptions) with auto-posting.
- CSV/JSON export, automated Postgres backups in compose (bank import already landed in Phase 1.5).
- Nice-to-haves backlog: receipt photo attachments, Splitwise-style settle-up, category rules ("payee contains 'Lidl' → Groceries"), widgets/shortcuts.

## 7. Project structure

```
/src
  /app            — Next.js routes (App Router)
    /(auth)       — login, register, invite
    /(app)        — dashboard, transactions, accounts, budgets, reports, settings
    /api          — route handlers: sync/, fx/, auth/
  /db             — Drizzle schema, migrations, seed
  /lib
    /sync         — outbox, pull cursor, merge logic (client)
    /fx           — rate fetching, conversion helpers
    /import       — CSV/XLSX parsing, per-bank profiles, dedupe hashing
    /domain       — money math (integer cents util), validation (zod schemas shared client/server)
  /components
/docker           — Dockerfile, compose.yaml, tailscale serve config
/.github/workflows — ci.yaml (lint/test/build), deploy.yaml (self-hosted runner)
/tests            — vitest unit (money math, sync merge, import profiles), Playwright e2e (incl. offline mode)
```

## 8. Key decisions & risks

| Decision | Rationale / risk |
|---|---|
| Money as `numeric(14,2)` in DB, integer cents in app code | Never floats. Zod-validated at the boundary. |
| Client-generated UUIDs | Enables idempotent offline sync; slight index-size cost, worth it. |
| Last-write-wins conflicts | Fine for 2 users; revisit only if real conflicts show up. |
| iOS PWA limits | No Background Sync on iOS Safari — fall back to sync-on-open/on-focus. Storage can be evicted if unused ~7 days; outbox flush on every open mitigates. **iPhone is a primary target device — test there from the first Phase 2 build, not at the end.** |
| FX from open.er-api.com | Free, keyless, daily updates, covers ARS + PYG (ECB/frankfurter does not — that's why it was rejected). Provider isolated behind the `FxRate` interface so it's swappable. Rates update once/day — fine for our use. |
| Soft deletes everywhere | Required for sync correctness; periodic purge job for rows deleted >90 days. |
| Tailnet-only exposure via `tailscale serve` | Valid HTTPS with zero cert management; requires Tailscale on both phones. `tailscale funnel` is the one-line escape hatch if public access is ever wanted. |
| Deploys via self-hosted runner | No registry, no SSH keys or Tailscale secrets in GitHub — the runner connects outbound only. Cost: image builds happen on the home server (fine for this scale). |
| Bank import as engine + declarative profiles | One tested code path; adding a bank = adding a profile object, not new parsing code. |

## 9. Deployment & CI/CD

- **Repo:** `https://github.com/martomarzo/money-maker` — everything lives here; push to `main` triggers deploy.
- **Server:** home docker host, reachable via `tailscale ssh root@docker`. The app lives in `/opt/money-maker` (checkout, `.env`, volumes for postgres data and tailscale state).
- **Pipeline (GitHub Actions):**
  - `ci` job on GitHub-hosted runners: lint, typecheck, unit tests, build check. Runs on every push/PR.
  - `deploy` job on a **self-hosted runner** installed on the docker host (systemd service, dedicated user in the `docker` group): runs only on `main` after `ci` passes — checkout, `docker compose build`, `docker compose up -d`, prune old images.
- **Tailscale sidecar:** a `tailscale` container in the compose stack; the app container uses `network_mode: service:tailscale`. One-time `TS_AUTHKEY` for enrollment, state persisted in a volume, serve config mounted as JSON (`tailscale serve` → proxy `https://money-maker.<tailnet>.ts.net` → app port 3000). Tailnet-only by default.
- **Database:** postgres data in a named volume on the host; migrations run automatically on app start; nightly `pg_dump` into `/opt/money-maker/backups` (off-host copies formalized in Phase 4).

## 10. Open questions (answer before/during Phase 1)

1. ~~Which currencies?~~ **Answered: USD, EUR, ARS, PYG** — drove the switch to open.er-api.com. **Base currency: EUR** (changeable later; reports re-derive).
2. **Invite flow** — shareable invite link (zero infra); SMTP can be added later if ever wanted.
3. **Income tracking depth** — just "income" transactions for v1; salary schedules only if a real need appears.
4. ~~Budget style~~ **Answered: simple monthly caps per category.** Envelope/YNAB-style rejected as too big a build.
5. ~~History import~~ **Answered: yes — Revolut, Wise, Itaú (PY), Santander (AR).** Drove the new Phase 1.5 bank-import phase with per-bank profiles.
