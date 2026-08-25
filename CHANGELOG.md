# Changelog

User-facing summary of what changed in Money Maker, one section per working
session (newest first). Internal refactors are mentioned only when they change
what you can do or how your data is organised.

## 2026-08-25

### Your ledger is private; sharing is explicit
- Every account, category, transaction, rule, import and budget now belongs to
  **you**, not to a household. Nobody else can see your ledger.
- **Share a transaction with a household** from its edit page. It stays in
  your ledger and additionally shows up in that household. The full amount is
  split **evenly among all current members** by default; you can edit the
  split or unshare at any time. One household per transaction.
- **Multiple households**: create as many as you like (partner, flatmates, a
  trip) and join others with an invite link. Household page shows shared
  spending for the month, by category, and who-owes-whom balances.
- Base currency is now per person (Settings) and per household.
- Your existing history was moved into your personal ledger untouched; the
  old household kept as an empty space to share into.
- The "personal / hide from partner" checkbox and joint accounts are gone —
  no longer needed.

### Faster capture
- **Add expense** is the primary button on the home screen and the floating
  `+` on every page. It opens a one-handed **quick-add** screen: on-screen
  keypad, account chips, category grid sorted by your usage, optional
  payee/date; saving keeps you there for the next entry.
- The app is **installable** ("Add to Home Screen") with its own icon.

### Dashboard & budgets
- Home is a dashboard: **net worth** in your base currency with every account
  grouped by currency; month selector; expenses / income / net tiles with
  per-currency subtotals; spending and income **by category** (click through
  to the transactions); **last 12 months** income-vs-expenses chart with hover
  details and a table view; recent transactions.
- **Budgets** page: set a monthly amount per category, see actual vs budget
  with an over-budget marker, and copy last month's budgets.

### Cleaning up imported history
- **Inline category select** on every transaction row.
- After picking a category, tap **"Always for “<payee>”"** to remember it as
  a rule and categorise every still-uncategorised match at once.
- **Uncategorized** filter in the list; the dashboard's Uncategorized bar
  links to it.
- On the edit page: rename or recategorise **all transactions with the same
  payee** in one go.
- **Transfers are editable**: name, date, notes, category; unlink a
  mismatched pair; convert an unlinked leg into an expense or income; and mark
  an expense/income as a transfer.

### Look & feel
- Full visual pass: consistent colours (light and dark), typography, buttons
  and cards; new navigation (Home · Transactions · + · Households · Settings);
  favicon and app icon.

### Retired
- Automatic Google Wallet / bank-notification capture (needed a third-party
  phone automation and never fired). The pages still exist under Settings as
  "experimental" but nothing depends on them.

## 2026-08-19

- Wallet capture (experimental): phone notifications could be forwarded to
  the app and auto-booked as expenses, with an inbox to fix unparsed ones and
  device/card management. Superseded on 2026-08-25.

## 2026-08-08

- First deploy on the home server over Tailscale (tailnet-only HTTPS).
- Accounts and transactions (expense, income, cross-currency transfers) with
  filters and per-currency / base-currency summaries.
- Daily FX rates (USD, EUR, ARS, PYG) and historical backfill to 2023-12.
- Bank history import for Revolut, Wise, Itaú (PY) and Santander (AR):
  preview → de-duplicate → auto-categorise with editable rules → commit, with
  undo per import; 58 statements / 2,273 rows loaded.
- Category management with merchant rules.
- Login, household creation and invite links.
