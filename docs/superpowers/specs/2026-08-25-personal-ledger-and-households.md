# Personal ledger & households — design (2026-08-25)

Status: **agreed with the user 2026-08-25, not yet built.** Supersedes the
"household owns everything + visibility flag" model from plan.md §3.

## 1. Why

The original model made the household the owner of accounts, categories and
transactions, with a per-row `visibility: shared | personal` flag to hide
rows from the partner. The user wants the opposite guarantee: **everything is
private by construction**, and sharing is an explicit, per-transaction act.
Two consequences fall out that the old model could not express:

- one person can belong to **several households** (partner, flatmates, a
  trip) and share different transactions with each;
- a shared transaction is **still a personal expense** — it never leaves the
  owner's ledger, it is additionally *visible* to one household.

## 2. Model

```
User            login identity; owns a PERSONAL LEDGER; has base_currency
  ├─ Account        (user-owned)  name, type, currency, initial_balance, archived
  ├─ Category       (user-owned)  tree, seeded per user at registration
  ├─ CategoryRule   (user-owned)
  ├─ ImportBatch    (user-owned)
  ├─ Budget         (user-owned)  category + month + amount   [Phase 1.6]
  └─ Transaction    (user-owned)  expense | income | transfer, always private
        └─ TransactionShare  0..1 per transaction → Household
               amount_shared   = full transaction amount (v1)
               splits[]        = per-member share, default even split
Household       name, base_currency; members via Membership; invites
```

Rules:

1. **A transaction has exactly one owner (its user) and lives only in that
   user's ledger.** No `household_id` on transactions, accounts, categories,
   rules, batches or budgets any more.
2. **Sharing = a `transaction_shares` row.** At most one per transaction
   (unique on `transaction_id`). Removing the row un-shares. The transaction
   row itself is never copied or moved; edits to it are seen by the household
   live. Only the owner can share/unshare/edit the split.
3. **Split.** A share carries `split` rows, one per household member at share
   time, `share_cents` summing to the transaction amount. Default: even split
   in the transaction's currency (remainder cents go to the payer). The owner
   can edit the split later (any distribution that sums correctly). Members
   who join later are not retroactively added.
4. **Who paid** = the transaction owner. Member balance in a household =
   Σ(paid by me) − Σ(my share) over shared transactions, converted to the
   household base currency. Shown read-only in v1; a "settle up" action that
   records a transfer is a later addition.
5. **Household sees:** date, amount+currency (and original amount/currency),
   payee, notes, the sharer's **category name/icon as text** (categories are
   personal; no household taxonomy in v1), who paid, the split. It does *not*
   see the account.
6. **Transfers and income can be shared too** (income shared into a household
   is rare but harmless: it just shows as +); the default share UI is for
   expenses.
7. **Base currency:** per user (`users.base_currency`) for the personal
   ledger; per household for household views. Same `fx_rates` table.
8. **Visibility flag is removed.** Its job is done by the presence of a
   share row.

## 3. Schema changes (migration 0004)

- `users`: add `base_currency char(3) not null default 'EUR'`.
- `accounts`, `categories`, `category_rules`, `import_batches`, `budgets`,
  `transactions`: replace `household_id` with `user_id` (FK users, not null);
  rebuild the `(owner, server_seq)` indexes on `user_id`. Drop
  `accounts.owner_user_id`. Drop `transactions.visibility` (and the enum).
- New `transaction_shares`:
  `id, transaction_id (unique, FK transactions on delete cascade),
  household_id (FK), shared_by_user_id (FK), created_at, updated_at,
  deleted_at, server_seq` (sync-tracked).
- New `transaction_share_splits`:
  `share_id (FK cascade), user_id (FK), share_cents bigint` — PK
  (share_id, user_id). Stored in the transaction's currency.
- `households`, `memberships`, `invites` unchanged. `wallet_*` unchanged
  (already user-scoped).
- **Data migration (in the same SQL file):** for every row with a
  `household_id`, set `user_id` = the household's single current member
  (assert exactly one member per household that owns data; the live DB has
  one household, one member). No share rows are created ("all become
  personal, household kept empty" — user decision). `users.base_currency`
  copied from the household. Migration must be idempotent and abort loudly if
  a household with data has ≠1 member.

## 4. Query layer (`src/lib/queries.ts`)

Two families, never mixed:

- **Personal:** `listAccounts(userId)`, `listTransactions(userId, filters)`,
  `listCategories(userId)`, balances, summaries — all filtered by `user_id`
  only. No visibility clauses anywhere. Each transaction row carries
  `share: { householdId, householdName } | null` so the list can badge it.
- **Household:** `listSharedTransactions(householdId, viewerUserId)` joins
  `transaction_shares → transactions` (+ owner display name, category name)
  after asserting membership; `summarizeHousehold(householdId)` totals by
  category name / by payer / by month in household base currency;
  `memberBalances(householdId)`.

`requireMembership()` goes away. `requireUserId()` is the gate for personal
pages; `requireHouseholdMember(householdId)` for household pages.

## 5. Routes & UI

- Personal (default, no household needed):
  `/` dashboard, `/transactions`, `/transactions/new`, `/accounts`,
  `/settings/categories`, `/import`, `/budgets` (1.6) — all as today minus the
  visibility checkbox.
- **Share controls:** on the transaction form and on each list row: "Share
  with… ▸ [household]" → creates the share with an even split; sharing state
  shown as a badge (household name). Share sheet lets the owner edit the
  split (amount per member, must sum) or unshare.
- Households: `/households` (list + create + join-by-code), 
  `/households/[id]` (shared transactions feed, totals by category/payer,
  member balances, month selector), `/households/[id]/settings` (name, base
  currency, members, invite link). Onboarding no longer forces creating one;
  registration creates the personal ledger (seeded categories + rules).
- The app shell gets a **Households** entry (replaces "Settings" slot on
  mobile; settings moves under the header avatar/menu).

## 6. Sync & offline (Phase 2 impact)

The personal ledger is the sync unit (cursor per user, not per household).
Shares and splits are sync-tracked too; a household feed is a server-side
read (online-only) in Phase 2 v1 — offline capture only ever writes to the
personal ledger, which is exactly the quick-add use case.

## 7. Build order

1. Migration 0004 + schema + `db:generate`; tests for the split math
   (`src/lib/domain/split.ts`: even split with remainder to payer, validation
   that splits sum to amount, PYG zero-decimal).
2. Queries + actions re-scoped to `user_id`; remove visibility everywhere;
   seed categories/rules at **registration**.
3. Share actions (`shareTransaction`, `updateSplit`, `unshareTransaction`)
   + share UI on form/list.
4. Households routes (list/create/join/feed/settings) — reuse invite flow.
5. Import + wallet + FX backfill re-pointed at `user_id`; onboarding rewrite.
6. Deploy: migration runs on boot; verify the live data landed in the
   personal ledger (row counts before/after, balances unchanged).

Verification bar per step: lint, typecheck, tests, build; step 6 also a live
smoke test (add an expense, share it, view it from the household page).

## 8. Out of scope (recorded so they are not forgotten)

- Household-level categories/taxonomy and rules.
- Settle-up action / recording repayments (balances are shown only).
- Sharing one transaction with more than one household.
- Partial-amount shares (the whole amount is shared; the split is where
  "portion" lives).
- Retroactively adding late-joining members to existing splits.
