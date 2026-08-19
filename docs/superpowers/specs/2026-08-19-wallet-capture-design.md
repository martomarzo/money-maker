# Wallet Capture — Design Spec (Phase 1.7)

_Date: 2026-08-19 · Status: awaiting user review_

## Goal

Every contactless/in-app card payment made on either phone lands in Money Maker
automatically, seconds after the tap: booked as a real expense on the right
account, auto-categorized via the existing `category_rules`, defaulting to
`personal` visibility, with a one-tap way to flip it to `shared` (and to fix
category / teach a new rule) from an inbox in the web app.

Context that shaped the design:

- Bank statement imports (Phase 1.5) were a **one-time historical backfill**.
  Going forward, card spending arrives only through wallet capture; everything
  else is entered manually. Therefore **no capture↔import reconciliation** is
  built — the only dedupe needed is idempotency of the ingest endpoint itself.
- Both phones already run Tailscale, so phone→app HTTPS over the tailnet works
  today with zero new exposure.
- The web app (PWA) remains the primary interface on every device including
  desktop. This feature is purely additive: one new page, one settings
  section, one API route.

## Non-goals (v1)

- No custom native apps. Android uses an off-the-shelf automation app; iOS
  uses the built-in Shortcuts app. (iOS forbids third-party notification
  reading anyway.)
- No on-phone confirmation dialogs — all fix-up happens in the web inbox.
- No refund/income detection: anything that doesn't parse as a plain payment
  becomes an `unparsed` capture in the inbox, never a wrong transaction.
- No reconciliation against future statement imports (see above).

## Architecture

```
Android phone                        iPhone (partner)
Google Wallet / bank app notif       Apple Pay tap
      │ MacroDroid macro                   │ Shortcuts "Transaction" automation
      │ (notification trigger)             │ (iOS 17+, runs immediately)
      └── POST /api/wallet/capture ────────┘   over the tailnet,
                       │                       Authorization: Bearer <device token>
          hash → dedupe → parse → map card → account
                       │
          category_rules match (reuses suggestCategory)
                       │
          insert into transactions (expense, personal, account currency,
          original_amount/currency preserved, fx_rate_to_base stamped)
                       │
          /wallet inbox: share ▸ recategorize (+create rule) ▸ assign account
```

## Phone clients

### Android — MacroDroid (free tier), no code

- Trigger: **Notification Received**, watching Google Wallet
  (`com.google.android.apps.walletnfcrel`) — and optionally bank apps later
  (Revolut frequently posts the payment notification itself; the payload's
  `app` field tells the server which source it was, and the parser is
  format-tolerant rather than per-app).
- Action: **HTTP Request (POST)**, JSON body (contract below), header
  `Authorization: Bearer <token>`.
- Setup documented step-by-step in `docs/wallet-android-setup.md`.
- Because the server stores every raw payload even when parsing fails, the
  first days of real taps double as format discovery — the parser's fixture
  suite grows from real captured text, no throwaway spike needed.

### iPhone — Shortcuts "Transaction" automation, no code

- Automation trigger: **Transaction** (iOS 17+), scoped to the chosen card(s),
  set to *Run Immediately*. Fires on every Apple Pay use and provides
  structured data: merchant, amount, card name.
- Shortcut body: **Get Contents of URL** POST with the `ios_transaction`
  payload and the partner's own device token — so captures are created as the
  partner (`created_by`), respecting personal-account visibility.
- Setup documented in `docs/wallet-ios-setup.md`.
- Caveat: the trigger covers Apple Pay transactions; physical-card swipes
  outside Apple Pay don't fire it (those remain manual entry).

## API contract

`POST /api/wallet/capture` — bearer token auth (no session cookie), zod-validated:

```jsonc
// Android (raw notification, server parses)
{
  "kind": "android_notification",
  "app": "com.google.android.apps.walletnfcrel",
  "title": "…notification title…",
  "text": "…notification text…",
  "postedAt": "2026-08-19T12:34:56Z"   // client clock, ISO-8601
}

// iOS (already structured by the Shortcuts trigger)
{
  "kind": "ios_transaction",
  "merchant": "Starbucks",
  "amount": "4.50",                     // string; may carry symbol/locale format
  "currency": "EUR",                    // when the shortcut can supply it
  "cardName": "Revolut",
  "postedAt": "2026-08-19T12:34:56Z"
}
```

Responses: `201` (capture stored; body includes capture id + status),
`200` (duplicate `capture_hash` — idempotent replay, no-op), `401` (bad token).
The endpoint never returns 4xx for unparseable *content* — that's a stored
`unparsed` capture, not an error.

## Schema — migration 0003

Three server-only tables (NOT sync-tracked — no `server_seq`; the resulting
`transactions` rows sync as usual):

- **`wallet_devices`**: `id`, `user_id` FK, `name`, `token_hash` (sha256 of
  the token; plaintext shown exactly once at creation), `created_at`,
  `revoked_at` nullable, `last_seen_at`.
- **`wallet_card_mappings`**: `id`, `user_id` FK, `card_key` text (normalized:
  last-4 digits from Android notifications, lowercased card name from iOS),
  `account_id` FK, unique `(user_id, card_key)`.
- **`wallet_captures`**: `id`, `device_id` FK, `kind`, `raw` jsonb (full
  payload as received), `capture_hash` text unique, `status`
  (`booked` | `needs_account` | `unparsed` | `dismissed`), parsed fields
  (`amount_minor`, `currency`, `merchant`, `card_key` — all nullable),
  `transaction_id` FK nullable (set when booked), `created_at`.

`capture_hash = sha256(device_id | kind | canonical-json(payload))` — the
client timestamp is part of the payload, so an automation-app retry of the
same POST is a no-op while two identical purchases at different times are not.

## Ingest pipeline (`src/lib/wallet/`)

Pure, unit-tested functions mirroring the import engine's structure:

1. **Parse** (`parse.ts`): Android — extract amount + currency + merchant +
   card last-4 from title/text; tolerant of `1.234,56` / `1,234.56` decimals
   and `€ / $ / US$ / Gs. / ₲` symbols (all four household currencies). iOS —
   normalize the already-structured fields (strip symbols from `amount`); a
   payload with no resolvable currency is treated as being in the mapped
   account's currency (the common case: tapping in the card's own currency).
   Output: `ParsedPayment | null`. Null ⇒ capture stored as `unparsed`.
2. **Map card → account**: look up `wallet_card_mappings` by
   `(device.user_id, card_key)`. No mapping (or no card in the text) ⇒ status
   `needs_account`, held in inbox. **No fallback default account** — a capture
   is never silently booked to the wrong place.
3. **Categorize**: reuse `suggestCategory` / `normalizeMatchText` from
   `src/lib/import/engine.ts` against the household's `category_rules`
   (merchant text as haystack, account-currency filters apply). No match ⇒
   `category_id` null (shows in the existing needs-review filter).
4. **Currency**: transaction `amount` must be in the account's currency
   (schema rule). If the parsed currency differs (e.g. PYG tap on a EUR card),
   convert via `fx_rates` for the capture date and preserve the tap amount in
   the existing `original_amount` / `original_currency` columns. Same-currency
   taps book verbatim.
5. **Insert transaction**: `type=expense`, `visibility=personal` (default —
   flipped to shared from the inbox), `created_by = device.user_id`, date from
   `postedAt`, payee = merchant, `fx_rate_to_base` stamped the same way
   `src/lib/actions/transactions.ts` does. Capture row updated to `booked` +
   `transaction_id`.

## UI

- **`/wallet` inbox** (new page in `(app)`): recent captures, newest first,
  status-badged. Per row:
  - **Share** — one tap flips the linked transaction's `visibility` to shared.
  - **Categorize** — category picker; checkbox "always categorize *«merchant»*
    like this" creates a `category_rule` (same UX idea as import preview).
  - **Assign account** (for `needs_account`) — account picker + "remember this
    card" creates the `wallet_card_mappings` row, then books the transaction.
  - **Dismiss** (for `unparsed` noise, e.g. non-payment Wallet notifications).
- **`/settings/devices`**: create device (name → token displayed once),
  revoke; manage card mappings (list/edit/delete).

## Security

- Tokens: 32 random bytes, stored as sha256 hash, compared constant-time;
  revocable per device; `last_seen_at` updated on use. Tailnet-only exposure
  is defense-in-depth on top, not the auth story.
- The endpoint is scoped to the token's user: it can only create expenses in
  that user's household, visible per normal visibility rules. It cannot read
  anything.
- Raw notification text may contain merchant/amount data only — same
  sensitivity class as the transactions table it feeds.

## Testing

- Parser: fixture file of notification texts (seeded synthetic, grown with
  real captured samples; real samples are fine to commit — merchant + amount
  only, same as any transaction fixture).
- Pipeline: card mapping hit/miss, rule matching, cross-currency conversion,
  personal-default, hash idempotency (replay ⇒ no second transaction).
- Endpoint: auth (missing/bad/revoked token), zod rejection, duplicate replay.
- Existing suites must stay green (`lint`, `typecheck`, `vitest`, `build`).

## Rollout

1. Deploy (migration 0003 applies on boot, like 0001/0002).
2. Create a device token in `/settings/devices` for the Android phone; set up
   the MacroDroid macro per `docs/wallet-android-setup.md`; make a real tap.
3. First captures likely land `unparsed`/`needs_account` — that's the
   feedback loop: fix from the inbox, extend parser fixtures if needed.
4. Partner repeats with the iOS shortcut per `docs/wallet-ios-setup.md`.

## Decisions log

| Decision | Rationale |
|---|---|
| Automation app + Shortcuts, no native apps | iOS can't read notifications at all; Android doesn't need to. Zero app maintenance; all logic server-side and tested. |
| Auto-commit + inbox (not confirm-first) | User choice: fully automatic bookkeeping, touch only what needs fixing. |
| `card_key` generic (last4 or card name) | iOS Transaction trigger provides card *name*, Android notifications provide last-4. One mapping table serves both. |
| No fallback account | A capture booked to the wrong account is worse than one waiting in the inbox. |
| Default `visibility=personal` | User asked for an *option* to share; sharing is the explicit action. |
| No import reconciliation | Statement imports are historical-only from now on (user decision, 2026-08-19). |
| Tables not sync-tracked | Captures/devices/mappings are server-side plumbing; only the resulting transactions sync to clients. |
