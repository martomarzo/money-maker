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

- **One generic import engine + per-bank profiles.** A profile declares: column mapping, date format, decimal style (`1.234,56` vs `1,234.56`), amount convention (single signed column vs separate Débito/Crédito columns), header language, currency handling.
- v1 profiles:
  - **Revolut** — CSV, ISO dates, single signed amount column, per-currency.
  - **Wise** — CSV, per-currency balance statements, exchange metadata on conversions.
  - **Itaú Paraguay** — Spanish headers, dd/mm/yyyy, separate debit/credit columns, PYG (no decimals).
  - **Santander Argentina** — Spanish headers, dd/mm/yyyy, decimal comma, separate debit/credit columns, ARS.
- Accepts **CSV and XLSX** (SheetJS) — the Latin banks usually export XLS, no manual conversion step.
- Flow: upload → pick account + profile (auto-detected from headers when possible) → preview parsed rows → dedupe check → import.
- **Idempotent re-imports:** each imported row stores a source hash (account + date + amount + description); re-uploading the same or an overlapping statement skips existing rows. The dedupe heuristic also flags manually-entered duplicates (same account + date + amount).
- Imported rows land uncategorized; bulk-categorize in the preview (payee-contains suggestions).

**Milestone: full multi-bank history in the app; reports reflect reality.**

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
