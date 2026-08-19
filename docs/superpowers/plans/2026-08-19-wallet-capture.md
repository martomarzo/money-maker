# Wallet Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Card payments made on the phones auto-land in Money Maker as personal expenses via a token-authenticated ingest endpoint, auto-categorized by `category_rules`, with a `/wallet` inbox to share/recategorize/assign and a `/settings/devices` page for tokens and card mappings.

**Architecture:** Phones POST raw payment events (Android: MacroDroid forwards Google Wallet notification text; iOS: Shortcuts "Transaction" trigger sends structured fields) to `POST /api/wallet/capture`. A pure engine (`src/lib/wallet/engine.ts`, mirrors `src/lib/import/engine.ts` — no fs/db) parses and plans; the route and server actions own I/O. Three new server-only tables (migration 0003) store devices, card→account mappings, and every raw capture (unique hash ⇒ idempotent; failures become inbox rows, never wrong transactions).

**Tech Stack:** Next.js 16.3 App Router route handler + server actions, Drizzle ORM/Postgres, zod v4, vitest. **No new npm dependencies.**

**Spec:** `docs/superpowers/specs/2026-08-19-wallet-capture-design.md`

## Global Constraints

- **No new npm dependencies** (everything uses node:crypto, zod, drizzle already present). If a dependency ever changes, lockfile must be regenerated with `npx npm@10 install --package-lock-only` (CI's npm 10 rejects npm 11 lockfiles).
- **Money:** integer minor units in app code, `numeric(14,2)` strings at the DB boundary (`src/lib/domain/money.ts`); PYG has 0 decimals.
- **Never set `server_seq` in app code** (DB trigger stamps it). The three wallet tables are NOT sync-tracked — do not give them `syncColumns`.
- Wallet-created transactions: `type: "expense"`, positive amount, `visibility: "personal"`, account's native currency; foreign tap preserved in `original_amount`/`original_currency`.
- **Commits: plain sentence messages. NEVER add a Claude/AI co-author trailer or attribution.** No conventional-commit prefixes (repo style is plain sentences).
- Verify commands: `npm run lint`, `npm run typecheck` (runs `next typegen` first — required), `npm test`, `npm run build`.
- This repo's Next.js (16.3) may differ from training data — if a route-handler/API signature surprises you, read `node_modules/next/dist/docs/` (AGENTS.md rule) before improvising.
- Path alias `@/*` → `src/*` works in app code and tests.

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schema.ts` (modify) | + `walletCaptureStatus` enum, `walletDevices`, `walletCardMappings`, `walletCaptures` |
| `src/db/migrations/0003_*.sql` (generated) | migration for the above |
| `src/lib/wallet/types.ts` (create) | zod contract for the two capture payload kinds |
| `src/lib/wallet/tokens.ts` (create) | device-token generate/hash |
| `src/lib/wallet/engine.ts` (create) | PURE: parse notification/transaction → `ParsedPayment`; hash; amount/card-key normalize; category suggestion wrapper |
| `src/lib/wallet/book.ts` (create) | db: turn a stored capture + account into a transaction (shared by route + assign action) |
| `src/app/api/wallet/capture/route.ts` (create) | POST ingest: token auth → dedupe → parse → map → book |
| `src/lib/queries.ts` (modify) | + `usablePostingAccount`, `listWalletDevices`, `listWalletCardMappings`, `listWalletCaptures` |
| `src/lib/actions/transactions.ts` (modify) | use shared `usablePostingAccount` (drop private copy) |
| `src/lib/actions/wallet.ts` (create) | server actions: device CRUD, share/recategorize/assign/dismiss, mapping delete |
| `src/app/(app)/wallet/page.tsx` + `src/components/wallet-inbox.tsx` (create) | captures inbox |
| `src/app/(app)/settings/devices/page.tsx` + `src/components/wallet-devices-panel.tsx` (create) | devices + mappings management |
| `tests/wallet-engine.test.ts`, `tests/wallet-parse.test.ts` (create) | unit tests for the pure layer |
| `docs/wallet-android-setup.md`, `docs/wallet-ios-setup.md` (create) | phone setup guides |

---

### Task 1: Schema + migration 0003

**Files:**
- Modify: `src/db/schema.ts` (append after `fxRates`, ~line 305)
- Generated: `src/db/migrations/0003_*.sql` via `npm run db:generate`

**Interfaces:**
- Consumes: existing `users`, `accounts`, `transactions` tables; `pgEnum/pgTable/jsonb/…` from drizzle.
- Produces: exported Drizzle tables `walletDevices`, `walletCardMappings`, `walletCaptures` and enum `walletCaptureStatus` — all later tasks import these from `@/db/schema`. Column property names exactly as written below (`tokenHash`, `cardKey`, `captureHash`, `amountMinor`, `transactionId`, `revokedAt`, `lastSeenAt`).

- [ ] **Step 1: Add `jsonb` to the drizzle-orm/pg-core import list** at the top of `src/db/schema.ts` (it is not currently imported).

- [ ] **Step 2: Append the wallet tables to `src/db/schema.ts`**

```ts
// ---------------------------------------------------------------------------
// Wallet capture (Phase 1.7). Server-only plumbing — NOT sync-tracked; the
// transactions a capture books are what sync. Raw payloads are kept forever
// so failed parses can be retried/booked later from the inbox.
// ---------------------------------------------------------------------------

export const walletCaptureStatus = pgEnum("wallet_capture_status", [
  "booked",
  "needs_account",
  "unparsed",
  "dismissed",
]);

export const walletDevices = pgTable("wallet_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // sha256 hex of the bearer token; plaintext is shown once at creation.
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const walletCardMappings = pgTable(
  "wallet_card_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Normalized: last-4 digits (Android notifications) or lowercased card
    // name (iOS Transaction trigger).
    cardKey: text("card_key").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("wallet_card_mappings_user_key_idx").on(t.userId, t.cardKey),
  ],
);

export const walletCaptures = pgTable(
  "wallet_captures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => walletDevices.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    // Full payload exactly as received — source of truth for (re)booking.
    raw: jsonb("raw").notNull(),
    // sha256(device_id | canonical payload) — makes ingest idempotent.
    captureHash: text("capture_hash").notNull().unique(),
    status: walletCaptureStatus("status").notNull(),
    // Parsed fields, display-only (booking re-derives from `raw`).
    amountMinor: bigint("amount_minor", { mode: "number" }),
    currency: char("currency", { length: 3 }),
    merchant: text("merchant"),
    cardKey: text("card_key"),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("wallet_captures_device_idx").on(t.deviceId, t.createdAt)],
);
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `src/db/migrations/0003_<random_name>.sql` containing `CREATE TYPE "public"."wallet_capture_status"` and `CREATE TABLE` for `wallet_devices`, `wallet_card_mappings`, `wallet_captures` (+ unique indexes on `token_hash`, `capture_hash`, `(user_id, card_key)`). Open it and confirm there are NO changes to existing tables (if drizzle tries to alter anything else, stop — the schema edit touched something it shouldn't have).

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "Add wallet capture schema: devices, card mappings, captures (migration 0003)"
```

---

### Task 2: Payload contract, tokens, hash, amount/card-key helpers

**Files:**
- Create: `src/lib/wallet/types.ts`
- Create: `src/lib/wallet/tokens.ts`
- Create: `src/lib/wallet/engine.ts` (partial — parsing arrives in Task 3)
- Test: `tests/wallet-engine.test.ts`

**Interfaces:**
- Consumes: `toCents`, `decimalsFor` from `@/lib/domain/money`.
- Produces (used by Tasks 3–5):
  - `capturePayloadSchema` (zod discriminated union on `kind`), type `CapturePayload` from `@/lib/wallet/types`
  - `generateDeviceToken(): string`, `hashDeviceToken(token: string): string` from `@/lib/wallet/tokens`
  - `captureHash(deviceId: string, payload: CapturePayload): string`, `normalizeCardKey(raw: string): string`, `amountToMinor(amountRaw: string, currency: string): number` from `@/lib/wallet/engine`

- [ ] **Step 1: Write the failing tests** — `tests/wallet-engine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  amountToMinor,
  captureHash,
  normalizeCardKey,
} from "@/lib/wallet/engine";
import { generateDeviceToken, hashDeviceToken } from "@/lib/wallet/tokens";
import { capturePayloadSchema, type CapturePayload } from "@/lib/wallet/types";

const androidPayload: CapturePayload = {
  kind: "android_notification",
  app: "com.google.android.apps.walletnfcrel",
  title: "€4,50 with Visa •••• 1234",
  text: "Starbucks",
  postedAt: "2026-08-19T12:34:56Z",
};

describe("capturePayloadSchema", () => {
  it("accepts an android payload", () => {
    expect(capturePayloadSchema.parse(androidPayload)).toEqual(androidPayload);
  });

  it("accepts an ios payload and defaults optional text fields", () => {
    const parsed = capturePayloadSchema.parse({
      kind: "ios_transaction",
      amount: "4.50",
      postedAt: "2026-08-19T12:34:56Z",
    });
    expect(parsed).toMatchObject({ merchant: "", cardName: "" });
  });

  it("rejects an unknown kind and a missing postedAt", () => {
    expect(capturePayloadSchema.safeParse({ kind: "nope" }).success).toBe(false);
    expect(
      capturePayloadSchema.safeParse({ ...androidPayload, postedAt: undefined })
        .success,
    ).toBe(false);
  });
});

describe("captureHash", () => {
  it("is stable for the same device + payload", () => {
    expect(captureHash("dev-1", androidPayload)).toBe(
      captureHash("dev-1", { ...androidPayload }),
    );
  });

  it("differs across devices and across postedAt", () => {
    expect(captureHash("dev-2", androidPayload)).not.toBe(
      captureHash("dev-1", androidPayload),
    );
    expect(
      captureHash("dev-1", { ...androidPayload, postedAt: "2026-08-19T12:35:00Z" }),
    ).not.toBe(captureHash("dev-1", androidPayload));
  });
});

describe("tokens", () => {
  it("generates distinct url-safe tokens and hashes deterministically", () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hashDeviceToken(a)).toBe(hashDeviceToken(a));
    expect(hashDeviceToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("normalizeCardKey", () => {
  it("lowercases and trims", () => {
    expect(normalizeCardKey("  Revolut ")).toBe("revolut");
    expect(normalizeCardKey("1234")).toBe("1234");
  });
});

describe("amountToMinor", () => {
  it("handles 2-decimal currencies via toCents", () => {
    expect(amountToMinor("4,50", "EUR")).toBe(450);
    expect(amountToMinor("1.234,56", "ARS")).toBe(123456);
    expect(amountToMinor("1,234.56", "USD")).toBe(123456);
    expect(amountToMinor("12.50", "EUR")).toBe(1250);
  });

  it("treats separators as thousands in zero-decimal currencies", () => {
    expect(amountToMinor("25.000", "PYG")).toBe(25000);
    expect(amountToMinor("1,500,000", "PYG")).toBe(1500000);
  });

  it("throws on garbage", () => {
    expect(() => amountToMinor("abc", "EUR")).toThrow();
    expect(() => amountToMinor("12a", "PYG")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/wallet-engine.test.ts`
Expected: FAIL — cannot resolve `@/lib/wallet/engine` (module not created yet).

- [ ] **Step 3: Implement**

`src/lib/wallet/types.ts`:

```ts
// Zod contract for POST /api/wallet/capture. Two payload kinds:
// android_notification = raw notification text forwarded by MacroDroid
// (server parses it); ios_transaction = already-structured fields from the
// iOS Shortcuts "Transaction" automation trigger.

import { z } from "zod";

const isoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "expected ISO-8601 datetime");

export const androidCaptureSchema = z.object({
  kind: z.literal("android_notification"),
  app: z.string().min(1).max(200),
  title: z.string().max(2000).default(""),
  text: z.string().max(4000).default(""),
  postedAt: isoDateTime,
});

export const iosCaptureSchema = z.object({
  kind: z.literal("ios_transaction"),
  merchant: z.string().max(500).default(""),
  amount: z.string().min(1).max(50),
  currency: z.string().max(10).optional(),
  cardName: z.string().max(200).default(""),
  postedAt: isoDateTime,
});

export const capturePayloadSchema = z.discriminatedUnion("kind", [
  androidCaptureSchema,
  iosCaptureSchema,
]);

export type CapturePayload = z.infer<typeof capturePayloadSchema>;
```

`src/lib/wallet/tokens.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, base64url — shown to the user exactly once. */
export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What we store/look up: sha256 hex of the token. */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

`src/lib/wallet/engine.ts` (first slice — parsing functions land in Task 3):

```ts
// Pure logic for wallet captures (Phase 1.7). No fs, no db — mirrors
// src/lib/import/engine.ts. Callers (the ingest route, server actions)
// own all I/O.

import { createHash } from "node:crypto";
import { decimalsFor, toCents } from "@/lib/domain/money";
import type { CapturePayload } from "./types";

/** Idempotency key: same device + identical payload ⇒ same hash. Key order
 *  is canonicalized so a re-serialized retry still matches. */
export function captureHash(deviceId: string, payload: CapturePayload): string {
  const record = payload as unknown as Record<string, unknown>;
  const canonical = JSON.stringify(
    Object.keys(record)
      .sort()
      .map((k) => [k, record[k]]),
  );
  return createHash("sha256").update(`${deviceId}|${canonical}`).digest("hex");
}

/** Card keys are matched case-insensitively ("Revolut" ≡ "revolut"). */
export function normalizeCardKey(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Amount token → integer minor units of `currency`. Zero-decimal
 *  currencies (PYG) treat '.' and ',' purely as thousands separators:
 *  "₲ 25.000" is 25000, not 25.00. Throws on garbage. */
export function amountToMinor(amountRaw: string, currency: string): number {
  if (decimalsFor(currency) === 0) {
    const digits = amountRaw.replace(/[.,\s]/g, "");
    if (!/^\d+$/.test(digits)) throw new Error(`Invalid amount: ${amountRaw}`);
    const value = Number(digits);
    if (!Number.isSafeInteger(value)) throw new Error(`Amount overflow: ${amountRaw}`);
    return value;
  }
  return toCents(amountRaw, currency);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/wallet-engine.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Verify lint/typecheck**

Run: `npm run lint && npm run typecheck`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/wallet/ tests/wallet-engine.test.ts
git commit -m "Add wallet capture payload contract, device tokens, hash and amount helpers"
```

---

### Task 3: Notification/transaction parser + category suggestion wrapper

**Files:**
- Modify: `src/lib/wallet/engine.ts` (append)
- Test: `tests/wallet-parse.test.ts`

**Interfaces:**
- Consumes: `CapturePayload` from `./types`; `suggestCategory`, `CategoryRule`, `TransactionDraft` types from `@/lib/import/engine` (signature: `suggestCategory(draft: TransactionDraft, rules: CategoryRule[], accountId?: string): string | null`).
- Produces (used by Tasks 4–5):

```ts
export interface ParsedPayment {
  amountRaw: string;       // cleaned amount token, e.g. "4,50" or "25.000"
  currency: string | null; // EUR/USD/ARS/PYG when determinable; null ⇒ use the account's currency
  merchant: string | null;
  cardKey: string | null;  // NOT yet normalized — callers apply normalizeCardKey
  date: string;            // YYYY-MM-DD from postedAt
}
export function findAmount(s: string): { amountRaw: string; currency: string | null } | null;
export function parseAndroidNotification(title: string, text: string, postedAt: string): ParsedPayment | null;
export function parseIosTransaction(p: { merchant: string; amount: string; currency?: string; cardName: string; postedAt: string }): ParsedPayment | null;
export function parseCapture(payload: CapturePayload): ParsedPayment | null;
export function suggestCategoryForMerchant(merchant: string | null, currency: string, accountId: string, rules: CategoryRule[]): string | null;
```

- [ ] **Step 1: Write the failing tests** — `tests/wallet-parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CategoryRule } from "@/lib/import/engine";
import {
  findAmount,
  parseAndroidNotification,
  parseCapture,
  parseIosTransaction,
  suggestCategoryForMerchant,
} from "@/lib/wallet/engine";

const POSTED = "2026-08-19T12:34:56Z";

describe("findAmount", () => {
  it("recognizes euro symbol with comma decimals", () => {
    expect(findAmount("€4,50 with Visa")).toEqual({ amountRaw: "4,50", currency: "EUR" });
  });
  it("recognizes guarani thousands", () => {
    expect(findAmount("₲ 25.000 con Mastercard")).toEqual({ amountRaw: "25.000", currency: "PYG" });
    expect(findAmount("Gs. 150.000")).toEqual({ amountRaw: "150.000", currency: "PYG" });
  });
  it("recognizes US$ before bare $", () => {
    expect(findAmount("US$ 12.99")).toEqual({ amountRaw: "12.99", currency: "USD" });
  });
  it("returns null currency for a bare $ (ambiguous)", () => {
    expect(findAmount("$1.234,56 en Coto")).toEqual({ amountRaw: "1.234,56", currency: null });
  });
  it("matches amount-before-code order too", () => {
    expect(findAmount("12.50 EUR")).toEqual({ amountRaw: "12.50", currency: "EUR" });
  });
  it("returns null when there is no currency-adjacent amount", () => {
    expect(findAmount("Your card ending 1234 was added")).toBeNull();
    expect(findAmount("")).toBeNull();
  });
});

describe("parseAndroidNotification", () => {
  it("parses the classic Google Wallet shape (amount+card in title, merchant in text)", () => {
    const p = parseAndroidNotification("€4,50 with Visa •••• 1234", "Starbucks", POSTED);
    expect(p).toEqual({
      amountRaw: "4,50",
      currency: "EUR",
      merchant: "Starbucks",
      cardKey: "1234",
      date: "2026-08-19",
    });
  });

  it("parses an 'at MERCHANT with' sentence and 'ending in' last4", () => {
    const p = parseAndroidNotification(
      "Payment",
      "You paid US$12.99 at Amazon with Mastercard ending in 5678",
      POSTED,
    );
    expect(p).toMatchObject({ amountRaw: "12.99", currency: "USD", merchant: "Amazon", cardKey: "5678" });
  });

  it("parses a Spanish guarani notification", () => {
    const p = parseAndroidNotification("₲ 25.000 con Visa •• 9012", "Pago en Superseis", POSTED);
    expect(p).toMatchObject({ amountRaw: "25.000", currency: "PYG", merchant: "Superseis", cardKey: "9012" });
  });

  it("returns null for a non-payment notification", () => {
    expect(parseAndroidNotification("Google Wallet", "Your card was added to Wallet", POSTED)).toBeNull();
  });
});

describe("parseIosTransaction", () => {
  it("uses the explicit currency field when present", () => {
    const p = parseIosTransaction({ merchant: "Farmacia Catedral", amount: "€7.20", currency: "eur", cardName: "Revolut", postedAt: POSTED });
    expect(p).toMatchObject({ amountRaw: "7.20", currency: "EUR", merchant: "Farmacia Catedral", cardKey: "revolut" });
  });

  it("accepts a bare numeric amount with no currency", () => {
    const p = parseIosTransaction({ merchant: "M", amount: "12.50", cardName: "Wise", postedAt: POSTED });
    expect(p).toMatchObject({ amountRaw: "12.50", currency: null });
  });

  it("returns null when amount is not numeric", () => {
    expect(parseIosTransaction({ merchant: "M", amount: "pending", cardName: "", postedAt: POSTED })).toBeNull();
  });
});

describe("parseCapture", () => {
  it("dispatches on kind", () => {
    expect(
      parseCapture({ kind: "android_notification", app: "x", title: "€1,00 with Visa •••• 1111", text: "Shop", postedAt: POSTED }),
    ).toMatchObject({ currency: "EUR" });
    expect(
      parseCapture({ kind: "ios_transaction", merchant: "Shop", amount: "1.00", currency: "EUR", cardName: "Revolut", postedAt: POSTED }),
    ).toMatchObject({ cardKey: "revolut" });
  });
});

describe("suggestCategoryForMerchant", () => {
  const rules: CategoryRule[] = [
    { id: "r1", matchText: "starbucks", accountId: null, currency: null, categoryId: "cat-coffee", priority: 0 },
  ];
  it("matches accent/case-insensitively via the import engine", () => {
    expect(suggestCategoryForMerchant("STARBUCKS Madrid", "EUR", "acc-1", rules)).toBe("cat-coffee");
  });
  it("returns null with no merchant or no match", () => {
    expect(suggestCategoryForMerchant(null, "EUR", "acc-1", rules)).toBeNull();
    expect(suggestCategoryForMerchant("Lidl", "EUR", "acc-1", rules)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/wallet-parse.test.ts`
Expected: FAIL — `findAmount` etc. not exported.

- [ ] **Step 3: Implement** — append to `src/lib/wallet/engine.ts`:

```ts
import { suggestCategory, type CategoryRule, type TransactionDraft } from "@/lib/import/engine";

export interface ParsedPayment {
  amountRaw: string;
  currency: string | null;
  merchant: string | null;
  cardKey: string | null;
  date: string;
}

// "4,50" | "12.50" | "1.234,56" | "1,234.56" | "25.000" (thousands) …
const AMOUNT_SRC = String.raw`(\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;

// Order matters: multi-char tokens (US$) before the ambiguous bare $.
const CURRENCY_TOKENS: ReadonlyArray<readonly [string, string | null]> = [
  [String.raw`US\$|U\$S|USD`, "USD"],
  [String.raw`EUR|€`, "EUR"],
  [String.raw`ARS`, "ARS"],
  [String.raw`PYG|Gs\.?|₲`, "PYG"],
  [String.raw`\$`, null], // bare $ — resolved to the account's currency later
];

/** First currency-adjacent amount in `s` (symbol/code before or after). */
export function findAmount(
  s: string,
): { amountRaw: string; currency: string | null } | null {
  for (const [tok, code] of CURRENCY_TOKENS) {
    const re = new RegExp(
      `(?:${tok})\\s?${AMOUNT_SRC}|${AMOUNT_SRC}\\s?(?:${tok})`,
      "iu",
    );
    const m = re.exec(s);
    if (m) return { amountRaw: (m[1] ?? m[2])!, currency: code };
  }
  return null;
}

const LAST4 = /(?:[•*xX]{2,}\s*|\bending(?:\s+in)?\s+|\bterminad[ao]\s+en\s+)(\d{4})\b/u;

function extractMerchant(title: string, text: string): string | null {
  // "at Amazon with Mastercard…" / "en Superseis." — sentence form first.
  const at = /\b(?:at|en)\s+(.{2,80}?)(?:\s+(?:with|con)\b|[.\n]|$)/iu.exec(
    `${title}\n${text}`,
  );
  if (at) return at[1].trim();
  // Otherwise: whichever line is NOT the amount line is the merchant
  // (classic Google Wallet: title = amount+card, text = merchant).
  for (const line of [text, title]) {
    const cleaned = line.trim();
    if (cleaned && !findAmount(cleaned)) return cleaned;
  }
  return null;
}

export function parseAndroidNotification(
  title: string,
  text: string,
  postedAt: string,
): ParsedPayment | null {
  const combined = `${title}\n${text}`;
  const found = findAmount(combined);
  if (!found) return null;
  const last4 = LAST4.exec(combined);
  return {
    amountRaw: found.amountRaw,
    currency: found.currency,
    merchant: extractMerchant(title, text),
    cardKey: last4 ? last4[1] : null,
    date: postedAt.slice(0, 10),
  };
}

export function parseIosTransaction(p: {
  merchant: string;
  amount: string;
  currency?: string;
  cardName: string;
  postedAt: string;
}): ParsedPayment | null {
  const trimmedAmount = p.amount.trim();
  const found =
    findAmount(trimmedAmount) ??
    (/^[\d.,\s]+$/.test(trimmedAmount)
      ? { amountRaw: trimmedAmount, currency: null }
      : null);
  if (!found) return null;
  const explicit = p.currency?.trim().toUpperCase();
  return {
    amountRaw: found.amountRaw,
    currency: explicit && /^[A-Z]{3}$/.test(explicit) ? explicit : found.currency,
    merchant: p.merchant.trim() || null,
    cardKey: p.cardName.trim() ? normalizeCardKey(p.cardName) : null,
    date: p.postedAt.slice(0, 10),
  };
}

export function parseCapture(payload: CapturePayload): ParsedPayment | null {
  return payload.kind === "android_notification"
    ? parseAndroidNotification(payload.title, payload.text, payload.postedAt)
    : parseIosTransaction(payload);
}

/** category_rules suggestion for a captured merchant — same matcher the
 *  import preview uses (case/accent-insensitive substring, priority wins). */
export function suggestCategoryForMerchant(
  merchant: string | null,
  currency: string,
  accountId: string,
  rules: CategoryRule[],
): string | null {
  if (!merchant) return null;
  const draft: TransactionDraft = {
    index: 0,
    date: "",
    type: "expense",
    amountCents: 0,
    currency,
    payee: merchant,
    notes: null,
    originalAmountCents: null,
    originalCurrency: null,
    sourceHash: null,
    kind: "purchase",
  };
  return suggestCategory(draft, rules, accountId);
}
```

Note: the `import { … } from "@/lib/import/engine"` line belongs at the top of the file with the other imports — move it there, don't leave a mid-file import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/wallet-parse.test.ts tests/wallet-engine.test.ts`
Expected: PASS. If a regex test fails, fix the regex — do NOT loosen the test expectation; these shapes come from the spec.

- [ ] **Step 5: Verify lint/typecheck, run the whole suite**

Run: `npm run lint && npm run typecheck && npm test`
Expected: pass (80 pre-existing tests + new ones).

- [ ] **Step 6: Commit**

```bash
git add src/lib/wallet/engine.ts tests/wallet-parse.test.ts
git commit -m "Parse wallet notifications and iOS transactions into payments with category suggestions"
```

---

### Task 4: Booking helper + ingest route

**Files:**
- Create: `src/lib/wallet/book.ts`
- Create: `src/app/api/wallet/capture/route.ts`
- Modify: `src/lib/queries.ts` (add `usablePostingAccount` only — the other queries come in Task 5)
- Modify: `src/lib/actions/transactions.ts` (use the shared helper)

**Interfaces:**
- Consumes: Task 1 tables; Task 2/3 engine exports; `getRate` from `@/lib/fx` (`(date, from, to) => Promise<number | null>`); `centsToDecimalString`, `convertCents` from `@/lib/domain/money`; `listCategoryRules(householdId)` from `@/lib/queries` (rows are structurally compatible with `CategoryRule[]`).
- Produces:
  - `usablePostingAccount(householdId: string, userId: string, accountId: string)` in `@/lib/queries` — returns the account row or undefined (in household, not deleted, joint or owned by user).
  - `bookCapture(input: BookCaptureInput): Promise<string | null>` in `@/lib/wallet/book` — books a stored capture as a transaction, flips the capture to `booked`; null when the raw payload can't be parsed/converted. `BookCaptureInput = { capture: { id: string; raw: unknown }; account: { id: string; currency: string }; householdId: string; userId: string; baseCurrency: string; rules: CategoryRule[] }`.
  - `POST /api/wallet/capture` route.

- [ ] **Step 1: Add `usablePostingAccount` to `src/lib/queries.ts`** (it needs `or` added to the drizzle-orm import there):

```ts
/** Account usable for posting by this user: in household, not deleted, and
 *  either joint or owned by them. (Shared by transaction actions, wallet
 *  ingest, and wallet server actions.) */
export async function usablePostingAccount(
  householdId: string,
  userId: string,
  accountId: string,
) {
  return db.query.accounts.findFirst({
    where: and(
      eq(accounts.id, accountId),
      eq(accounts.householdId, householdId),
      isNull(accounts.deletedAt),
      or(isNull(accounts.ownerUserId), eq(accounts.ownerUserId, userId)),
    ),
  });
}
```

Then in `src/lib/actions/transactions.ts`: delete the private `usableAccount` function (lines ~36–47), add `import { usablePostingAccount } from "@/lib/queries";`, and replace the four `usableAccount(` call sites with `usablePostingAccount(`. Remove now-unused imports (`accounts`, and `or`/`isNull` if nothing else uses them — check before removing).

- [ ] **Step 2: Create `src/lib/wallet/book.ts`**

```ts
// Books a stored wallet capture as an expense transaction. Server-side only
// (db + fx I/O). Shared by the ingest route (auto-book on arrival) and the
// assign-account server action (booking a held `needs_account` capture).

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { transactions, walletCaptures } from "@/db/schema";
import { centsToDecimalString, convertCents } from "@/lib/domain/money";
import { getRate } from "@/lib/fx";
import type { CategoryRule } from "@/lib/import/engine";
import {
  amountToMinor,
  parseCapture,
  suggestCategoryForMerchant,
} from "./engine";
import { capturePayloadSchema } from "./types";

export interface BookCaptureInput {
  capture: { id: string; raw: unknown };
  account: { id: string; currency: string };
  householdId: string;
  userId: string;
  baseCurrency: string;
  rules: CategoryRule[];
}

/** Parse the capture's raw payload and insert the expense + mark the capture
 *  booked (one db transaction). Returns the transaction id, or null when the
 *  payload can't be parsed, the amount isn't positive, or a needed FX rate
 *  is missing — callers leave the capture in its current status then. */
export async function bookCapture(input: BookCaptureInput): Promise<string | null> {
  const payload = capturePayloadSchema.safeParse(input.capture.raw);
  if (!payload.success) return null;
  const parsed = parseCapture(payload.data);
  if (!parsed) return null;

  const accountCurrency = input.account.currency.trim();
  const tapCurrency = parsed.currency ?? accountCurrency;

  let tapCents: number;
  try {
    tapCents = amountToMinor(parsed.amountRaw, tapCurrency);
  } catch {
    return null;
  }
  if (tapCents <= 0) return null;

  let accountCents = tapCents;
  let originalAmount: string | null = null;
  let originalCurrency: string | null = null;
  if (tapCurrency !== accountCurrency) {
    const rate = await getRate(parsed.date, tapCurrency, accountCurrency);
    if (rate == null) return null;
    accountCents = convertCents(tapCents, rate, tapCurrency, accountCurrency);
    if (accountCents <= 0) return null;
    originalAmount = centsToDecimalString(tapCents, tapCurrency);
    originalCurrency = tapCurrency;
  }

  const baseRate = await getRate(
    parsed.date,
    accountCurrency,
    input.baseCurrency.trim(),
  );
  const categoryId = suggestCategoryForMerchant(
    parsed.merchant,
    accountCurrency,
    input.account.id,
    input.rules,
  );

  const txnId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      id: txnId,
      householdId: input.householdId,
      accountId: input.account.id,
      createdByUserId: input.userId,
      type: "expense",
      amount: centsToDecimalString(accountCents, accountCurrency),
      currency: accountCurrency,
      date: parsed.date,
      categoryId,
      payee: parsed.merchant,
      visibility: "personal",
      fxRateToBase: baseRate == null ? null : baseRate.toFixed(8),
      originalAmount,
      originalCurrency,
    });
    await tx
      .update(walletCaptures)
      .set({ status: "booked", transactionId: txnId })
      .where(eq(walletCaptures.id, input.capture.id));
  });
  return txnId;
}
```

- [ ] **Step 3: Create `src/app/api/wallet/capture/route.ts`**

```ts
// Ingest endpoint for phone wallet captures (Phase 1.7). Bearer device-token
// auth (no session). Never 4xxes on unparseable CONTENT — bad payloads are
// stored as `unparsed` captures for the /wallet inbox; only auth failures
// and empty bodies are rejected.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  households,
  memberships,
  walletCaptures,
  walletCardMappings,
  walletDevices,
} from "@/db/schema";
import { listCategoryRules, usablePostingAccount } from "@/lib/queries";
import { bookCapture } from "@/lib/wallet/book";
import {
  amountToMinor,
  captureHash,
  normalizeCardKey,
  parseCapture,
} from "@/lib/wallet/engine";
import { hashDeviceToken } from "@/lib/wallet/tokens";
import { capturePayloadSchema, type CapturePayload } from "@/lib/wallet/types";

/** Body → payload. Falls back to wrapping the raw text as an unstructured
 *  android payload when JSON parsing fails (MacroDroid can't JSON-escape
 *  notification text) — a capture is never lost to a quoting bug. */
async function readPayload(req: Request): Promise<CapturePayload | null> {
  const bodyText = await req.text();
  try {
    const parsed = capturePayloadSchema.safeParse(JSON.parse(bodyText));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to the raw wrapper
  }
  const trimmed = bodyText.trim();
  if (!trimmed) return null;
  return {
    kind: "android_notification",
    app: "unknown",
    title: "",
    text: trimmed.slice(0, 4000),
    postedAt: new Date().toISOString(),
  };
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const device = await db.query.walletDevices.findFirst({
    where: and(
      eq(walletDevices.tokenHash, hashDeviceToken(token)),
      isNull(walletDevices.revokedAt),
    ),
  });
  if (!device) return Response.json({ error: "unauthorized" }, { status: 401 });

  const payload = await readPayload(req);
  if (!payload) return Response.json({ error: "empty body" }, { status: 400 });

  const membership = await db.query.memberships.findFirst({
    where: eq(memberships.userId, device.userId),
  });
  if (!membership) {
    return Response.json({ error: "device user has no household" }, { status: 403 });
  }
  const householdId = membership.householdId;

  const parsed = parseCapture(payload);
  const cardKey = parsed?.cardKey ? normalizeCardKey(parsed.cardKey) : null;

  // Resolve card → account (only meaningful when parse succeeded).
  let account: { id: string; currency: string } | null = null;
  if (parsed && cardKey) {
    const mapping = await db.query.walletCardMappings.findFirst({
      where: and(
        eq(walletCardMappings.userId, device.userId),
        eq(walletCardMappings.cardKey, cardKey),
      ),
    });
    if (mapping) {
      const row = await usablePostingAccount(householdId, device.userId, mapping.accountId);
      if (row) account = { id: row.id, currency: row.currency };
    }
  }

  // Display-only parsed columns; booking re-derives from `raw`.
  let amountMinor: number | null = null;
  if (parsed?.currency) {
    try {
      amountMinor = amountToMinor(parsed.amountRaw, parsed.currency);
    } catch {
      amountMinor = null;
    }
  }

  const inserted = await db
    .insert(walletCaptures)
    .values({
      deviceId: device.id,
      kind: payload.kind,
      raw: payload,
      captureHash: captureHash(device.id, payload),
      status: parsed ? "needs_account" : "unparsed",
      amountMinor,
      currency: parsed?.currency ?? null,
      merchant: parsed?.merchant ?? null,
      cardKey,
    })
    .onConflictDoNothing({ target: walletCaptures.captureHash })
    .returning({ id: walletCaptures.id });

  await db
    .update(walletDevices)
    .set({ lastSeenAt: new Date() })
    .where(eq(walletDevices.id, device.id));

  if (inserted.length === 0) return Response.json({ duplicate: true }, { status: 200 });
  const captureId = inserted[0].id;

  if (parsed && account) {
    const [household, rules] = await Promise.all([
      db.query.households.findFirst({ where: eq(households.id, householdId) }),
      listCategoryRules(householdId),
    ]);
    const txnId = await bookCapture({
      capture: { id: captureId, raw: payload },
      account,
      householdId,
      userId: device.userId,
      baseCurrency: household!.baseCurrency,
      rules,
    });
    if (txnId) {
      return Response.json({ id: captureId, status: "booked" }, { status: 201 });
    }
    // Parse was OK but booking failed (e.g. missing FX rate) — capture
    // stays needs_account and can be booked from the inbox later.
  }

  return Response.json(
    { id: captureId, status: parsed ? "needs_account" : "unparsed" },
    { status: 201 },
  );
}
```

Check `listCategoryRules` in `src/lib/queries.ts:192` returns rows assignable to `CategoryRule[]` (matchText/accountId/currency/categoryId/priority) — if the row type has extra fields that's fine (structural typing); if `priority` comes back as bigint-mode-number it matches.

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass. There is no unit test for route/book (db-bound, consistent with the repo's action layer); the pure logic they call is covered by Tasks 2–3.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wallet/book.ts src/app/api/wallet/capture/ src/lib/queries.ts src/lib/actions/transactions.ts
git commit -m "Add wallet capture ingest endpoint with idempotent dedupe and auto-booking"
```

---

### Task 5: Wallet queries + server actions

**Files:**
- Modify: `src/lib/queries.ts` (append)
- Create: `src/lib/actions/wallet.ts`

**Interfaces:**
- Consumes: Task 1 tables, Task 4 `bookCapture`/`usablePostingAccount`, `generateDeviceToken`/`hashDeviceToken`, `requireMembership` from `@/lib/session`, `ActionResult` from `./auth` (`{ ok: boolean; error?: string }`-shaped).
- Produces (used by UI Tasks 6–7):
  - Queries: `listWalletDevices(userId)`, `listWalletCardMappings(userId)` (rows include `accountName`), `listWalletCaptures(userId, limit = 50)` (rows include txn `visibility`/`categoryId`/`amount`/`currency` via left join, and `deviceName`).
  - Actions: `createWalletDevice(prev: CreateDeviceResult | null, formData: FormData): Promise<CreateDeviceResult>` where `CreateDeviceResult = { ok: boolean; error?: string; token?: string; deviceName?: string }`; and `revokeWalletDevice`, `deleteWalletCardMapping`, `shareWalletCapture`, `recategorizeWalletCapture`, `assignWalletCaptureAccount`, `dismissWalletCapture` — each `(formData: FormData) => Promise<ActionResult>`.

- [ ] **Step 1: Append to `src/lib/queries.ts`** (add `walletCaptures`, `walletCardMappings`, `walletDevices`, `transactions` to its `@/db/schema` import as needed, and `desc` from drizzle-orm if not present):

```ts
export async function listWalletDevices(userId: string) {
  return db.query.walletDevices.findMany({
    where: eq(walletDevices.userId, userId),
    orderBy: desc(walletDevices.createdAt),
  });
}

export async function listWalletCardMappings(userId: string) {
  return db
    .select({
      id: walletCardMappings.id,
      cardKey: walletCardMappings.cardKey,
      accountId: walletCardMappings.accountId,
      accountName: accounts.name,
    })
    .from(walletCardMappings)
    .innerJoin(accounts, eq(walletCardMappings.accountId, accounts.id))
    .where(eq(walletCardMappings.userId, userId))
    .orderBy(walletCardMappings.cardKey);
}

/** Recent captures for the current user's devices, newest first, with the
 *  linked transaction's current state for inbox display. */
export async function listWalletCaptures(userId: string, limit = 50) {
  return db
    .select({
      id: walletCaptures.id,
      status: walletCaptures.status,
      kind: walletCaptures.kind,
      raw: walletCaptures.raw,
      amountMinor: walletCaptures.amountMinor,
      currency: walletCaptures.currency,
      merchant: walletCaptures.merchant,
      cardKey: walletCaptures.cardKey,
      createdAt: walletCaptures.createdAt,
      transactionId: walletCaptures.transactionId,
      deviceName: walletDevices.name,
      txnVisibility: transactions.visibility,
      txnCategoryId: transactions.categoryId,
      txnAmount: transactions.amount,
      txnCurrency: transactions.currency,
    })
    .from(walletCaptures)
    .innerJoin(walletDevices, eq(walletCaptures.deviceId, walletDevices.id))
    .leftJoin(transactions, eq(walletCaptures.transactionId, transactions.id))
    .where(eq(walletDevices.userId, userId))
    .orderBy(desc(walletCaptures.createdAt))
    .limit(limit);
}
```

- [ ] **Step 2: Create `src/lib/actions/wallet.ts`**

```ts
"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  categories,
  categoryRules,
  households,
  transactions,
  walletCaptures,
  walletCardMappings,
  walletDevices,
} from "@/db/schema";
import { listCategoryRules, usablePostingAccount } from "@/lib/queries";
import { requireMembership } from "@/lib/session";
import { bookCapture } from "@/lib/wallet/book";
import { generateDeviceToken, hashDeviceToken } from "@/lib/wallet/tokens";
import type { ActionResult } from "./auth";

export type CreateDeviceResult = {
  ok: boolean;
  error?: string;
  token?: string;
  deviceName?: string;
};

/** Capture owned by this user (via its device), or null. */
async function ownCapture(userId: string, captureId: string) {
  const rows = await db
    .select({ capture: walletCaptures, deviceUserId: walletDevices.userId })
    .from(walletCaptures)
    .innerJoin(walletDevices, eq(walletCaptures.deviceId, walletDevices.id))
    .where(eq(walletCaptures.id, captureId))
    .limit(1);
  const row = rows[0];
  return row && row.deviceUserId === userId ? row.capture : null;
}

export async function createWalletDevice(
  _prev: CreateDeviceResult | null,
  formData: FormData,
): Promise<CreateDeviceResult> {
  const { userId } = await requireMembership();
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 60) {
    return { ok: false, error: "Give the device a name (max 60 chars)" };
  }
  const token = generateDeviceToken();
  await db.insert(walletDevices).values({
    userId,
    name,
    tokenHash: hashDeviceToken(token),
  });
  revalidatePath("/settings/devices");
  // Plaintext token is returned exactly once and never stored.
  return { ok: true, token, deviceName: name };
}

export async function revokeWalletDevice(formData: FormData): Promise<ActionResult> {
  const { userId } = await requireMembership();
  const id = String(formData.get("id") ?? "");
  await db
    .update(walletDevices)
    .set({ revokedAt: new Date() })
    .where(and(eq(walletDevices.id, id), eq(walletDevices.userId, userId)));
  revalidatePath("/settings/devices");
  return { ok: true };
}

export async function deleteWalletCardMapping(formData: FormData): Promise<ActionResult> {
  const { userId } = await requireMembership();
  const id = String(formData.get("id") ?? "");
  await db
    .delete(walletCardMappings)
    .where(and(eq(walletCardMappings.id, id), eq(walletCardMappings.userId, userId)));
  revalidatePath("/settings/devices");
  return { ok: true };
}

export async function shareWalletCapture(formData: FormData): Promise<ActionResult> {
  const { userId, householdId } = await requireMembership();
  const capture = await ownCapture(userId, String(formData.get("captureId") ?? ""));
  if (!capture?.transactionId) return { ok: false, error: "Capture not booked" };
  await db
    .update(transactions)
    .set({ visibility: "shared", updatedAt: new Date() })
    .where(
      and(
        eq(transactions.id, capture.transactionId),
        eq(transactions.householdId, householdId),
      ),
    );
  revalidatePath("/wallet");
  revalidatePath("/transactions");
  return { ok: true };
}

const recategorizeSchema = z.object({
  captureId: z.uuid(),
  categoryId: z.uuid(),
});

export async function recategorizeWalletCapture(formData: FormData): Promise<ActionResult> {
  const { userId, householdId } = await requireMembership();
  const parsed = recategorizeSchema.safeParse({
    captureId: formData.get("captureId"),
    categoryId: formData.get("categoryId"),
  });
  if (!parsed.success) return { ok: false, error: "Pick a category" };
  const alwaysRule = formData.get("always") === "on";

  const capture = await ownCapture(userId, parsed.data.captureId);
  if (!capture?.transactionId) return { ok: false, error: "Capture not booked" };
  const category = await db.query.categories.findFirst({
    where: and(
      eq(categories.id, parsed.data.categoryId),
      eq(categories.householdId, householdId),
    ),
  });
  if (!category) return { ok: false, error: "Category not found" };

  await db
    .update(transactions)
    .set({ categoryId: category.id, updatedAt: new Date() })
    .where(
      and(
        eq(transactions.id, capture.transactionId),
        eq(transactions.householdId, householdId),
      ),
    );
  if (alwaysRule && capture.merchant) {
    await db.insert(categoryRules).values({
      householdId,
      matchText: capture.merchant,
      categoryId: category.id,
    });
  }
  revalidatePath("/wallet");
  revalidatePath("/transactions");
  return { ok: true };
}

const assignSchema = z.object({
  captureId: z.uuid(),
  accountId: z.uuid(),
});

export async function assignWalletCaptureAccount(formData: FormData): Promise<ActionResult> {
  const { userId, householdId } = await requireMembership();
  const parsed = assignSchema.safeParse({
    captureId: formData.get("captureId"),
    accountId: formData.get("accountId"),
  });
  if (!parsed.success) return { ok: false, error: "Pick an account" };
  const remember = formData.get("remember") === "on";

  const capture = await ownCapture(userId, parsed.data.captureId);
  if (!capture) return { ok: false, error: "Capture not found" };
  if (capture.status !== "needs_account") {
    return { ok: false, error: "Capture is not waiting for an account" };
  }
  const account = await usablePostingAccount(householdId, userId, parsed.data.accountId);
  if (!account) return { ok: false, error: "Account not found or not yours" };

  const [household, rules] = await Promise.all([
    db.query.households.findFirst({ where: eq(households.id, householdId) }),
    listCategoryRules(householdId),
  ]);
  const txnId = await bookCapture({
    capture: { id: capture.id, raw: capture.raw },
    account: { id: account.id, currency: account.currency },
    householdId,
    userId,
    baseCurrency: household!.baseCurrency,
    rules,
  });
  if (!txnId) {
    return { ok: false, error: "Could not turn this capture into a transaction" };
  }
  if (remember && capture.cardKey) {
    await db
      .insert(walletCardMappings)
      .values({ userId, cardKey: capture.cardKey, accountId: account.id })
      .onConflictDoUpdate({
        target: [walletCardMappings.userId, walletCardMappings.cardKey],
        set: { accountId: account.id },
      });
  }
  revalidatePath("/wallet");
  revalidatePath("/transactions");
  revalidatePath("/settings/devices");
  return { ok: true };
}

export async function dismissWalletCapture(formData: FormData): Promise<ActionResult> {
  const { userId } = await requireMembership();
  const capture = await ownCapture(userId, String(formData.get("captureId") ?? ""));
  if (!capture) return { ok: false, error: "Capture not found" };
  if (capture.status === "booked") {
    return { ok: false, error: "Already booked — delete the transaction instead" };
  }
  await db
    .update(walletCaptures)
    .set({ status: "dismissed" })
    .where(eq(walletCaptures.id, capture.id));
  revalidatePath("/wallet");
  return { ok: true };
}
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run typecheck && npm test`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries.ts src/lib/actions/wallet.ts
git commit -m "Add wallet queries and server actions for inbox fix-up and device management"
```

---

### Task 6: `/wallet` inbox page

**Files:**
- Create: `src/app/(app)/wallet/page.tsx`
- Create: `src/components/wallet-inbox.tsx`
- Modify: `src/app/(app)/layout.tsx` — add a nav link

**Interfaces:**
- Consumes: `listWalletCaptures`, `listVisibleAccounts`, `listCategories` from `@/lib/queries`; actions from `@/lib/actions/wallet`; `formatCents` from `@/lib/domain/money`.
- Produces: user-facing inbox. Styling: reuse the exact utility-class vocabulary of `src/app/(app)/settings/categories/page.tsx` (rounded-lg bordered rows, `border-black/10 dark:border-white/15`, small badge pills).

- [ ] **Step 1: Create `src/app/(app)/wallet/page.tsx`**

```tsx
import { requireMembership } from "@/lib/session";
import {
  listCategories,
  listVisibleAccounts,
  listWalletCaptures,
} from "@/lib/queries";
import { WalletInbox } from "@/components/wallet-inbox";

export default async function WalletPage() {
  const { userId, householdId } = await requireMembership();
  const [captures, accounts, categories] = await Promise.all([
    listWalletCaptures(userId),
    listVisibleAccounts(householdId, userId),
    listCategories(householdId),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Wallet captures</h1>
        <p className="text-sm opacity-70">
          Payments forwarded from your phone. Booked ones are already in your
          transactions — fix up the rest here.
        </p>
      </div>
      <WalletInbox
        captures={captures}
        accounts={accounts
          .filter((a) => !a.archived)
          .map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon }))}
      />
    </div>
  );
}
```

(If `listVisibleAccounts` rows don't expose exactly `archived`/`currency`, adapt the mapping to its real row shape — check its definition in `src/lib/queries.ts` first.)

- [ ] **Step 2: Create `src/components/wallet-inbox.tsx`** (server component — no `"use client"`; forms invoke server actions directly):

```tsx
import {
  assignWalletCaptureAccount,
  dismissWalletCapture,
  recategorizeWalletCapture,
  shareWalletCapture,
} from "@/lib/actions/wallet";
import { formatCents } from "@/lib/domain/money";
import type { listWalletCaptures } from "@/lib/queries";

type CaptureRow = Awaited<ReturnType<typeof listWalletCaptures>>[number];

const STATUS_LABEL: Record<CaptureRow["status"], string> = {
  booked: "Booked",
  needs_account: "Needs account",
  unparsed: "Unparsed",
  dismissed: "Dismissed",
};

/** Raw-payload fallback line for rows the parser couldn't handle. */
function rawSummary(row: CaptureRow): string {
  const raw = row.raw as Record<string, unknown>;
  if (row.kind === "android_notification") {
    return [raw.title, raw.text].filter(Boolean).join(" — ").slice(0, 140);
  }
  return [raw.merchant, raw.amount].filter(Boolean).join(" — ").slice(0, 140);
}

function amountLabel(row: CaptureRow): string | null {
  if (row.txnAmount && row.txnCurrency) {
    return `${row.txnAmount} ${row.txnCurrency.trim()}`;
  }
  if (row.amountMinor != null && row.currency) {
    return formatCents(row.amountMinor, row.currency.trim());
  }
  return null;
}

export function WalletInbox({
  captures,
  accounts,
  categories,
}: {
  captures: CaptureRow[];
  accounts: Array<{ id: string; name: string; currency: string }>;
  categories: Array<{ id: string; name: string; icon: string | null }>;
}) {
  if (captures.length === 0) {
    return (
      <p className="rounded-lg border border-black/10 p-6 text-sm opacity-70 dark:border-white/15">
        Nothing captured yet. Set up a device in Settings → Devices, then make
        a card payment.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {captures.map((row) => (
        <li
          key={row.id}
          className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 text-sm dark:border-white/15"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {row.merchant ?? rawSummary(row)}
              </span>
              {amountLabel(row) && (
                <span className="opacity-70">{amountLabel(row)}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
                {STATUS_LABEL[row.status]}
              </span>
              {row.status === "booked" && row.txnVisibility && (
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
                  {row.txnVisibility}
                </span>
              )}
            </div>
          </div>
          <p className="text-xs opacity-60">
            {row.deviceName}
            {row.cardKey ? ` · card ${row.cardKey}` : ""} ·{" "}
            {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
          </p>

          {row.status === "booked" && (
            <div className="flex flex-wrap items-end gap-3">
              {row.txnVisibility === "personal" && (
                <form action={shareWalletCapture}>
                  <input type="hidden" name="captureId" value={row.id} />
                  <button className="rounded-lg border border-black/10 px-3 py-1.5 font-medium transition hover:border-black/20 dark:border-white/15 dark:hover:border-white/30">
                    Mark shared
                  </button>
                </form>
              )}
              <form action={recategorizeWalletCapture} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="captureId" value={row.id} />
                <select
                  name="categoryId"
                  defaultValue={row.txnCategoryId ?? ""}
                  className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 dark:border-white/15"
                >
                  <option value="" disabled>
                    Category…
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon ? `${c.icon} ` : ""}
                      {c.name}
                    </option>
                  ))}
                </select>
                {row.merchant && (
                  <label className="flex items-center gap-1 text-xs opacity-80">
                    <input type="checkbox" name="always" />
                    always for “{row.merchant}”
                  </label>
                )}
                <button className="rounded-lg border border-black/10 px-3 py-1.5 font-medium transition hover:border-black/20 dark:border-white/15 dark:hover:border-white/30">
                  Set category
                </button>
              </form>
            </div>
          )}

          {row.status === "needs_account" && (
            <form action={assignWalletCaptureAccount} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="captureId" value={row.id} />
              <select
                name="accountId"
                defaultValue=""
                className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 dark:border-white/15"
              >
                <option value="" disabled>
                  Account…
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency.trim()})
                  </option>
                ))}
              </select>
              {row.cardKey && (
                <label className="flex items-center gap-1 text-xs opacity-80">
                  <input type="checkbox" name="remember" defaultChecked />
                  remember card {row.cardKey}
                </label>
              )}
              <button className="rounded-lg border border-black/10 px-3 py-1.5 font-medium transition hover:border-black/20 dark:border-white/15 dark:hover:border-white/30">
                Book expense
              </button>
            </form>
          )}

          {row.status !== "booked" && row.status !== "dismissed" && (
            <form action={dismissWalletCapture}>
              <input type="hidden" name="captureId" value={row.id} />
              <button className="text-xs opacity-60 underline-offset-2 hover:underline">
                Dismiss
              </button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
```

Note: server actions used directly in `<form action={…}>` must be `(formData: FormData) => Promise<…>` — Task 5 defined them that way. If the framework complains about return values in form actions, wrap each in a `async function … "use server"` void adapter — but try the direct form first.

- [ ] **Step 3: Add the nav link.** Find the nav in `src/app/(app)/layout.tsx`:

Run: `grep -n "href=\"/transactions\"" src/app/\(app\)/layout.tsx`

Add a `Wallet` link pointing to `/wallet` next to the Transactions entry, copying the exact element/classNames used by the existing links (do not invent new styles).

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: pass — `next build` compiles the new page/route.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/wallet/ src/components/wallet-inbox.tsx src/app/\(app\)/layout.tsx
git commit -m "Add /wallet inbox: share, recategorize, assign account, dismiss captures"
```

---

### Task 7: `/settings/devices` page

**Files:**
- Create: `src/app/(app)/settings/devices/page.tsx`
- Create: `src/components/wallet-devices-panel.tsx` (client — token reveal needs `useActionState`)
- Modify: wherever `/settings/categories` is linked in the settings navigation (find with `grep -rn "settings/categories" src/app src/components --include=*.tsx -l`) — add a matching `Devices` link to `/settings/devices`.

**Interfaces:**
- Consumes: `listWalletDevices`, `listWalletCardMappings` from `@/lib/queries`; `createWalletDevice` (+`CreateDeviceResult`), `revokeWalletDevice`, `deleteWalletCardMapping` from `@/lib/actions/wallet`.
- Produces: device/mapping management UI. Mapping creation stays inbox-only ("remember card") — this page only lists and deletes mappings (spec's "edit" = delete + re-learn).

- [ ] **Step 1: Create `src/app/(app)/settings/devices/page.tsx`**

```tsx
import { requireMembership } from "@/lib/session";
import { listWalletCardMappings, listWalletDevices } from "@/lib/queries";
import { WalletDevicesPanel } from "@/components/wallet-devices-panel";

export default async function DevicesSettingsPage() {
  const { userId } = await requireMembership();
  const [devices, mappings] = await Promise.all([
    listWalletDevices(userId),
    listWalletCardMappings(userId),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Devices</h1>
        <p className="text-sm opacity-70">
          Phones that forward wallet payments. Each device gets a token —
          shown once — used as the Bearer header in its automation.
        </p>
      </div>
      <WalletDevicesPanel
        devices={devices.map((d) => ({
          id: d.id,
          name: d.name,
          createdAt: d.createdAt.toISOString().slice(0, 10),
          lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString().slice(0, 16).replace("T", " ") : null,
          revoked: d.revokedAt != null,
        }))}
        mappings={mappings}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/wallet-devices-panel.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import {
  createWalletDevice,
  deleteWalletCardMapping,
  revokeWalletDevice,
  type CreateDeviceResult,
} from "@/lib/actions/wallet";

type Device = {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  revoked: boolean;
};
type Mapping = { id: string; cardKey: string; accountId: string; accountName: string };

export function WalletDevicesPanel({
  devices,
  mappings,
}: {
  devices: Device[];
  mappings: Mapping[];
}) {
  const [result, formAction, pending] = useActionState<CreateDeviceResult | null, FormData>(
    createWalletDevice,
    null,
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">
          Add device
        </h2>
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input
            name="name"
            placeholder="e.g. Martin's Pixel"
            required
            maxLength={60}
            className="rounded-lg border border-black/10 bg-transparent px-3 py-1.5 text-sm dark:border-white/15"
          />
          <button
            disabled={pending}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm font-medium transition hover:border-black/20 disabled:opacity-50 dark:border-white/15 dark:hover:border-white/30"
          >
            Create token
          </button>
        </form>
        {result && !result.ok && (
          <p className="text-sm text-red-600 dark:text-red-400">{result.error}</p>
        )}
        {result?.ok && result.token && (
          <div className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/15">
            <p className="font-medium">
              Token for “{result.deviceName}” — copy it now, it won't be shown again:
            </p>
            <code className="mt-1 block break-all rounded bg-black/5 p-2 text-xs dark:bg-white/10">
              {result.token}
            </code>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">
          Devices
        </h2>
        {devices.length === 0 && <p className="text-sm opacity-70">No devices yet.</p>}
        <ul className="flex flex-col gap-2">
          {devices.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/15"
            >
              <div>
                <span className="font-medium">{d.name}</span>
                <span className="ml-2 text-xs opacity-60">
                  added {d.createdAt}
                  {d.lastSeenAt ? ` · last seen ${d.lastSeenAt}` : " · never used"}
                </span>
              </div>
              {d.revoked ? (
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
                  revoked
                </span>
              ) : (
                <form action={revokeWalletDevice}>
                  <input type="hidden" name="id" value={d.id} />
                  <button className="text-xs text-red-600 underline-offset-2 hover:underline dark:text-red-400">
                    Revoke
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">
          Card mappings
        </h2>
        <p className="text-xs opacity-60">
          Created from the Wallet inbox (“remember card”). Delete one to
          re-teach it on the next capture.
        </p>
        {mappings.length === 0 && <p className="text-sm opacity-70">No mappings yet.</p>}
        <ul className="flex flex-col gap-2">
          {mappings.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/15"
            >
              <span>
                <code className="rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">
                  {m.cardKey}
                </code>{" "}
                → {m.accountName}
              </span>
              <form action={deleteWalletCardMapping}>
                <input type="hidden" name="id" value={m.id} />
                <button className="text-xs text-red-600 underline-offset-2 hover:underline dark:text-red-400">
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Add the settings nav link** (found via the grep in the Files block), matching existing link markup exactly.

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/settings/devices/ src/components/wallet-devices-panel.tsx
git commit -m "Add device and card-mapping management at /settings/devices"
# include the nav-link file in the git add if it lives elsewhere
```

---

### Task 8: Phone setup docs, status updates, final verification

**Files:**
- Create: `docs/wallet-android-setup.md`
- Create: `docs/wallet-ios-setup.md`
- Modify: `CLAUDE.md` (Session status), `plan.md` (mark Phase 1.7 built)
- Modify (outside repo, no commit): memory `project-status.md`

**Interfaces:** none — documentation and bookkeeping.

- [ ] **Step 1: Write `docs/wallet-android-setup.md`**

```markdown
# Android setup — forward Google Wallet payments to Money Maker

Requires: the phone on the tailnet (Tailscale app connected) and a device
token from https://money-maker.peacock-snapper.ts.net/settings/devices.

1. Install **MacroDroid** (free tier is enough). Grant it Notification
   Access when prompted (Settings → Notifications → Notification access).
2. Create a macro:
   - **Trigger:** Notification → Notification Received → Select
     Application(s) → **Google Wallet**. (Optionally also add your bank
     apps, e.g. Revolut — some banks post the payment notification
     themselves and Wallet stays silent.)
   - **Action:** Connectivity → **HTTP Request**:
     - Method: POST
     - URL: `https://money-maker.peacock-snapper.ts.net/api/wallet/capture`
     - Content type: `application/json`
     - Header: name `Authorization`, value `Bearer <YOUR-TOKEN>`
     - Body (insert the {…} placeholders via the magic-text picker — the
       exact token names in your MacroDroid version may differ slightly;
       pick "Notification title", "Notification text", "App package"):

       {"kind":"android_notification","app":"{not_app_package}","title":"{not_title}","text":"{notification}","postedAt":"{year}-{month_digit}-{dayofmonth}T{hour_0}:{minute}:00"}

   - **Constraints:** none needed.
3. Tap a card payment. Within seconds the purchase appears in
   /transactions (if the card is mapped) or in /wallet as "Needs account"
   (first time — assign the account there and tick "remember card").

Notes:
- If the notification text ever contains a double quote the JSON breaks;
  the server then stores the raw body as an unparsed capture — nothing is
  lost, book it manually from /wallet.
- Battery optimization can kill MacroDroid — exclude it (MacroDroid shows
  a warning with a shortcut to the setting).
```

- [ ] **Step 2: Write `docs/wallet-ios-setup.md`**

```markdown
# iPhone setup — forward Apple Pay transactions to Money Maker

Requires: iOS 17+, the phone on the tailnet (Tailscale app connected), and
a device token created for YOUR user at
https://money-maker.peacock-snapper.ts.net/settings/devices (log in as
yourself — captures are booked as the token's owner).

1. Open **Shortcuts** → Automation tab → **+** → **Transaction**.
2. Pick the card(s) to watch, choose **Run Immediately** (no confirmation).
3. For the automation's shortcut, add these actions:
   - **Dictionary** with keys:
     - `kind` = `ios_transaction`
     - `merchant` = the trigger's **Merchant** variable
     - `amount` = the trigger's **Amount** variable (as text)
     - `cardName` = the trigger's **Card or Pass** variable
     - `postedAt` = **Current Date** formatted as ISO 8601
   - **Get Contents of URL**:
     - URL: `https://money-maker.peacock-snapper.ts.net/api/wallet/capture`
     - Method: POST · Request Body: JSON → the Dictionary above
     - Headers: `Authorization` = `Bearer <YOUR-TOKEN>`
4. Tap to pay. First capture per card lands in /wallet as "Needs account" —
   assign the account and tick "remember card"; after that it's automatic.

Notes:
- The Transaction trigger fires on Apple Pay use only (physical-card swipes
  outside Apple Pay stay manual).
- The trigger's Amount usually carries the currency; if it arrives as a
  bare number the server assumes the mapped account's currency.
```

- [ ] **Step 3: Update `plan.md` Phase 1.7 section** — change its heading suffix from "(added 2026-08-19, being built next — ahead of 1.6)" to "(built <today's date>)" and append one line: setup guides at `docs/wallet-android-setup.md` / `docs/wallet-ios-setup.md`.

- [ ] **Step 4: Update `CLAUDE.md` Session status** — replace the "SPEC WRITTEN … awaiting user review" bullet with a "Phase 1.7 wallet capture COMPLETE" bullet: migration 0003, `src/lib/wallet/` (types/tokens/engine/book), `/api/wallet/capture`, `/wallet` inbox, `/settings/devices`, docs; note "NOT yet exercised against a live phone — first real captures will tune the parser via the unparsed-capture loop". Update the `_Last updated:_` date. Keep the "Then: Phase 1.6" bullet.

- [ ] **Step 5: Update memory** — in `/home/martomarzo/.claude/projects/-home-martomarzo-code-11-money-maker/memory/project-status.md`, mark Phase 1.7 implemented (pending live-phone shakeout) and next = phone setup + Phase 1.6.

- [ ] **Step 6: Full verification**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: ALL pass. Do not claim completion without this output.

- [ ] **Step 7: Single final commit and push** (docs + status together, per the repo's commit workflow)

```bash
git add docs/wallet-android-setup.md docs/wallet-ios-setup.md plan.md CLAUDE.md
git commit -m "Document phone setup for wallet capture; record Phase 1.7 as built"
git push
```

Pushing to main deploys; migration 0003 applies on boot. After deploy, the user creates the device token and follows `docs/wallet-android-setup.md`.
