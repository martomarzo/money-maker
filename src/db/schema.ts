import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  char,
  date,
  index,
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
export const visibility = pgEnum("visibility", ["shared", "personal"]);

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
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    // NULL = joint/shared account visible to all members
    ownerUserId: uuid("owner_user_id").references(() => users.id),
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
  (t) => [index("accounts_household_idx").on(t.householdId, t.serverSeq)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    icon: text("icon"),
    scope: categoryScope("scope").notNull().default("shared"),
    sortOrder: bigint("sort_order", { mode: "number" }).notNull().default(0),
    ...syncColumns,
  },
  (t) => [index("categories_household_idx").on(t.householdId, t.serverSeq)],
);

export const transactions = pgTable(
  "transactions",
  {
    // Client-generated UUID — enables idempotent offline sync.
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
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
    visibility: visibility("visibility").notNull().default("shared"),
    // Links the two legs of a transfer.
    transferPeerId: uuid("transfer_peer_id"),
    // Rate snapshotted for the transaction date; NULL until backfilled.
    fxRateToBase: numeric("fx_rate_to_base", { precision: 18, scale: 8 }),
    // Bank-import provenance (Phase 1.5): hash of account+date+amount+description.
    sourceHash: text("source_hash"),
    importBatchId: uuid("import_batch_id"),
    ...syncColumns,
  },
  (t) => [
    index("transactions_household_seq_idx").on(t.householdId, t.serverSeq),
    index("transactions_account_date_idx").on(t.accountId, t.date),
    uniqueIndex("transactions_source_hash_idx")
      .on(t.accountId, t.sourceHash)
      .where(sqlNotNull(t.sourceHash)),
  ],
);

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
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
    uniqueIndex("budgets_unique_idx").on(t.householdId, t.categoryId, t.month),
    index("budgets_household_idx").on(t.householdId, t.serverSeq),
  ],
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
