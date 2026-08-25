import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  char,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";

// Partial-index helper (drizzle needs a SQL fragment for WHERE clauses).
function sqlNotNull(col: AnyPgColumn): SQL {
  return sql`${col} is not null`;
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const membershipRole = pgEnum("membership_role", ["owner", "member"]);
export const accountType = pgEnum("account_type", [
  "checking",
  "savings",
  "cash",
  "credit_card",
]);
export const categoryScope = pgEnum("category_scope", ["shared", "personal"]);
export const transactionType = pgEnum("transaction_type", [
  "expense",
  "income",
  "transfer",
]);

// ---------------------------------------------------------------------------
// Sync bookkeeping
//
// Every sync-tracked table carries:
//   - created_at / updated_at / deleted_at (soft delete)
//   - server_seq: set by a DB trigger from a single global sequence on every
//     insert/update. Globally monotonic ⇒ per-household monotonic, so
//     /api/sync/pull?since=<seq> is clock-skew safe.
// ---------------------------------------------------------------------------

const syncColumns = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  serverSeq: bigint("server_seq", { mode: "bigint" }),
};

// ---------------------------------------------------------------------------
// Identity & household
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  // Base currency of the user's personal ledger (reports convert to it).
  baseCurrency: char("base_currency", { length: 3 }).notNull().default("EUR"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  baseCurrency: char("base_currency", { length: 3 }).notNull().default("EUR"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] })],
);

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedByUserId: uuid("used_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Finance entities
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    country: char("country", { length: 2 }),
    initialBalance: numeric("initial_balance", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    archived: boolean("archived").notNull().default(false),
    ...syncColumns,
  },
  (t) => [index("accounts_user_idx").on(t.userId, t.serverSeq)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    icon: text("icon"),
    scope: categoryScope("scope").notNull().default("shared"),
    sortOrder: bigint("sort_order", { mode: "number" }).notNull().default(0),
    ...syncColumns,
  },
  (t) => [index("categories_user_idx").on(t.userId, t.serverSeq)],
);

export const transactions = pgTable(
  "transactions",
  {
    // Client-generated UUID — enables idempotent offline sync.
    id: uuid("id").primaryKey(),
    // Owner of the personal ledger this row lives in. Never visible to other
    // users unless a transaction_shares row exists.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    type: transactionType("type").notNull(),
    // In the account's native currency. expense/income: always positive, `type`
    // gives the sign. transfer: signed — negative = outflow leg, positive = inflow leg.
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    date: date("date").notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    payee: text("payee"),
    notes: text("notes"),
    // Links the two legs of a transfer.
    transferPeerId: uuid("transfer_peer_id"),
    // Rate snapshotted for the transaction date; NULL until backfilled.
    fxRateToBase: numeric("fx_rate_to_base", { precision: 18, scale: 8 }),
    // Bank-import provenance (Phase 1.5): hash of account+date+amount+description.
    sourceHash: text("source_hash"),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
    // What the purchase was really made in when the account leg is a
    // pre-converted amount (e.g. Wise card spend in GBP on a EUR account).
    originalAmount: numeric("original_amount", { precision: 14, scale: 2 }),
    originalCurrency: char("original_currency", { length: 3 }),
    ...syncColumns,
  },
  (t) => [
    index("transactions_user_seq_idx").on(t.userId, t.serverSeq),
    index("transactions_account_date_idx").on(t.accountId, t.date),
    uniqueIndex("transactions_source_hash_idx")
      .on(t.accountId, t.sourceHash)
      .where(sqlNotNull(t.sourceHash)),
  ],
);

// One committed import run (Phase 1.5). Not sync-tracked — server-side
// provenance only; the transactions it created are what syncs. A batch may
// span accounts (Santander PDFs yield ARS + USD rows from one file), so
// account_id is the primary account or NULL for multi-account batches.
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id),
    // Parser id from the extraction pipeline (revolut, wise, itau_card, …).
    source: text("source").notNull(),
    filename: text("filename").notNull(),
    fileSha256: text("file_sha256").notNull(),
    dateFrom: date("date_from"),
    dateTo: date("date_to"),
    importedCount: bigint("imported_count", { mode: "number" })
      .notNull()
      .default(0),
    skippedDuplicateCount: bigint("skipped_duplicate_count", { mode: "number" })
      .notNull()
      .default(0),
    skippedFilteredCount: bigint("skipped_filtered_count", { mode: "number" })
      .notNull()
      .default(0),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("import_batches_user_idx").on(t.userId, t.createdAt)],
);

// Auto-categorization rules, applied as *suggestions* at import preview time.
// match_text is a case/accent-insensitive substring tested against
// description/merchant; lower priority number wins ties.
export const categoryRules = pgTable(
  "category_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    matchText: text("match_text").notNull(),
    // Optional narrowing filters; NULL = applies everywhere.
    accountId: uuid("account_id").references(() => accounts.id),
    currency: char("currency", { length: 3 }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    priority: bigint("priority", { mode: "number" }).notNull().default(0),
    ...syncColumns,
  },
  (t) => [index("category_rules_user_idx").on(t.userId, t.serverSeq)],
);

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    // First day of the budget month.
    month: date("month").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    ...syncColumns,
  },
  (t) => [
    uniqueIndex("budgets_unique_idx").on(t.userId, t.categoryId, t.month),
    index("budgets_user_idx").on(t.userId, t.serverSeq),
  ],
);

// ---------------------------------------------------------------------------
// Household sharing (Phase 1.9). A transaction stays in its owner's personal
// ledger; a share row makes it visible to exactly one household, with the
// full amount split among the members present at share time (even by
// default, owner-editable). Splits are in the transaction's currency.
// ---------------------------------------------------------------------------

export const transactionShares = pgTable(
  "transaction_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    sharedByUserId: uuid("shared_by_user_id")
      .notNull()
      .references(() => users.id),
    ...syncColumns,
  },
  (t) => [
    uniqueIndex("transaction_shares_transaction_idx").on(t.transactionId),
    index("transaction_shares_household_idx").on(t.householdId, t.serverSeq),
  ],
);

export const transactionShareSplits = pgTable(
  "transaction_share_splits",
  {
    shareId: uuid("share_id")
      .notNull()
      .references(() => transactionShares.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    shareCents: bigint("share_cents", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.shareId, t.userId] })],
);

export const fxRates = pgTable(
  "fx_rates",
  {
    date: date("date").notNull(),
    fromCurrency: char("from_currency", { length: 3 }).notNull(),
    toCurrency: char("to_currency", { length: 3 }).notNull(),
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.date, t.fromCurrency, t.toCurrency] })],
);

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
