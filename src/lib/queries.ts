import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  categories,
  categoryRules,
  households,
  memberships,
  transactionShareSplits,
  transactionShares,
  transactions,
  users,
  walletCaptures,
  walletCardMappings,
  walletDevices,
} from "@/db/schema";
import { decimalsFor, toCents } from "@/lib/domain/money";

// ---------------------------------------------------------------------------
// PERSONAL LEDGER — everything here is scoped by user_id and nothing else.
// A user can never see another user's rows through these functions.
// ---------------------------------------------------------------------------

export async function listAccounts(userId: string) {
  return db.query.accounts.findMany({
    where: and(eq(accounts.userId, userId), isNull(accounts.deletedAt)),
    orderBy: [accounts.archived, accounts.name],
  });
}

/** Accounts with current balance in minor units (initial + signed sum). */
export async function listAccountsWithBalances(userId: string) {
  const own = await listAccounts(userId);
  if (own.length === 0) return [];

  const sums = await db
    .select({
      accountId: transactions.accountId,
      signedSum: sql<string>`coalesce(sum(
        case ${transactions.type}
          when 'income' then ${transactions.amount}
          when 'expense' then -${transactions.amount}
          else ${transactions.amount}
        end), 0)`,
    })
    .from(transactions)
    .where(
      and(
        inArray(
          transactions.accountId,
          own.map((a) => a.id),
        ),
        isNull(transactions.deletedAt),
      ),
    )
    .groupBy(transactions.accountId);

  const sumByAccount = new Map(sums.map((s) => [s.accountId, s.signedSum]));
  return own.map((account) => {
    const currency = account.currency.trim();
    return {
      ...account,
      currency,
      balanceCents:
        toCents(account.initialBalance, currency) +
        toCents(sumByAccount.get(account.id) ?? "0", currency),
    };
  });
}

export interface TransactionFilters {
  accountId?: string;
  categoryId?: string;
  type?: "expense" | "income" | "transfer";
  shared?: "yes" | "no";
  from?: string; // ISO date, inclusive
  to?: string; // ISO date, inclusive
}

export async function listTransactions(
  userId: string,
  filters: TransactionFilters = {},
  limit = 200,
) {
  const rows = await db
    .select({
      transaction: transactions,
      accountName: accounts.name,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      shareHouseholdId: transactionShares.householdId,
      shareHouseholdName: households.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(
      transactionShares,
      and(
        eq(transactionShares.transactionId, transactions.id),
        isNull(transactionShares.deletedAt),
      ),
    )
    .leftJoin(households, eq(transactionShares.householdId, households.id))
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        filters.accountId ? eq(transactions.accountId, filters.accountId) : undefined,
        filters.categoryId ? eq(transactions.categoryId, filters.categoryId) : undefined,
        filters.type ? eq(transactions.type, filters.type) : undefined,
        filters.shared === "yes" ? sql`${transactionShares.id} is not null` : undefined,
        filters.shared === "no" ? sql`${transactionShares.id} is null` : undefined,
        filters.from ? gte(transactions.date, filters.from) : undefined,
        filters.to ? lte(transactions.date, filters.to) : undefined,
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    transaction: { ...r.transaction, currency: r.transaction.currency.trim() },
    accountName: r.accountName,
    categoryName: r.categoryName,
    categoryIcon: r.categoryIcon,
    share:
      r.shareHouseholdId && r.shareHouseholdName
        ? { householdId: r.shareHouseholdId, householdName: r.shareHouseholdName }
        : null,
  }));
}

export type TransactionListRow = Awaited<ReturnType<typeof listTransactions>>[number];

/** Per-currency expense/income totals plus a base-currency total where rates
 *  are known. Transfers are excluded. `pendingRateCount` > 0 means some rows
 *  still await an FX rate and the base total is incomplete. */
export function summarizeTransactions(
  rows: ReadonlyArray<{
    transaction: {
      type: "expense" | "income" | "transfer";
      amount: string;
      currency: string;
      fxRateToBase: string | null;
    };
  }>,
  baseCurrency: string,
) {
  const byCurrency = new Map<string, { expenseCents: number; incomeCents: number }>();
  let baseExpenseCents = 0;
  let baseIncomeCents = 0;
  let pendingRateCount = 0;

  for (const { transaction: t } of rows) {
    if (t.type === "transfer") continue;
    const bucket = byCurrency.get(t.currency) ?? { expenseCents: 0, incomeCents: 0 };
    const cents = toCents(t.amount, t.currency);
    if (t.type === "expense") bucket.expenseCents += cents;
    else bucket.incomeCents += cents;
    byCurrency.set(t.currency, bucket);

    if (t.fxRateToBase != null) {
      const baseCents = toBaseCents(cents, t.currency, t.fxRateToBase, baseCurrency);
      if (t.type === "expense") baseExpenseCents += baseCents;
      else baseIncomeCents += baseCents;
    } else {
      pendingRateCount++;
    }
  }

  return { byCurrency, baseCurrency, baseExpenseCents, baseIncomeCents, pendingRateCount };
}

function toBaseCents(cents: number, currency: string, rate: string, baseCurrency: string) {
  return Math.round(
    (cents / 10 ** decimalsFor(currency)) * Number(rate) * 10 ** decimalsFor(baseCurrency),
  );
}

export async function listCategories(userId: string) {
  return db.query.categories.findMany({
    where: and(eq(categories.userId, userId), isNull(categories.deletedAt)),
    orderBy: [categories.sortOrder, categories.name],
  });
}

export async function listCategoryRules(userId: string) {
  return db
    .select({
      rule: categoryRules,
      categoryName: categories.name,
      categoryIcon: categories.icon,
    })
    .from(categoryRules)
    .innerJoin(categories, eq(categoryRules.categoryId, categories.id))
    .where(and(eq(categoryRules.userId, userId), isNull(categoryRules.deletedAt)))
    .orderBy(categoryRules.priority, categoryRules.matchText);
}

/** Account usable for posting by this user: theirs and not deleted. (Shared
 *  by transaction actions, wallet ingest, and wallet server actions.) */
export async function usablePostingAccount(userId: string, accountId: string) {
  return db.query.accounts.findFirst({
    where: and(
      eq(accounts.id, accountId),
      eq(accounts.userId, userId),
      isNull(accounts.deletedAt),
    ),
  });
}

/** A transaction owned by the user (not deleted), or undefined. */
export async function ownTransaction(userId: string, transactionId: string) {
  return db.query.transactions.findFirst({
    where: and(
      eq(transactions.id, transactionId),
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
    ),
  });
}

// ---------------------------------------------------------------------------
// HOUSEHOLDS — membership, and the shared-transaction view.
// Callers must have verified membership (requireHouseholdMember) first.
// ---------------------------------------------------------------------------

export async function listHouseholds(userId: string) {
  return db
    .select({
      id: households.id,
      name: households.name,
      baseCurrency: households.baseCurrency,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(households, eq(households.id, memberships.householdId))
    .where(eq(memberships.userId, userId))
    .orderBy(households.name);
}

export async function listMembers(householdId: string) {
  return db
    .select({ id: users.id, displayName: users.displayName, role: memberships.role })
    .from(users)
    .innerJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.householdId, householdId)),
    )
    .orderBy(memberships.createdAt);
}

/** The share (with splits) on one of the user's own transactions, if any. */
export async function getShareForTransaction(transactionId: string) {
  const share = await db.query.transactionShares.findFirst({
    where: and(
      eq(transactionShares.transactionId, transactionId),
      isNull(transactionShares.deletedAt),
    ),
  });
  if (!share) return null;
  const splits = await db
    .select({
      userId: transactionShareSplits.userId,
      shareCents: transactionShareSplits.shareCents,
      displayName: users.displayName,
    })
    .from(transactionShareSplits)
    .innerJoin(users, eq(users.id, transactionShareSplits.userId))
    .where(eq(transactionShareSplits.shareId, share.id));
  return { ...share, splits };
}

export interface HouseholdFeedFilters {
  from?: string;
  to?: string;
}

/** Transactions shared into a household, newest first, with who paid, the
 *  sharer's category (as text) and the per-member split. Never exposes the
 *  account. */
export async function listSharedTransactions(
  householdId: string,
  filters: HouseholdFeedFilters = {},
  limit = 300,
) {
  const rows = await db
    .select({
      shareId: transactionShares.id,
      transactionId: transactions.id,
      type: transactions.type,
      amount: transactions.amount,
      currency: transactions.currency,
      date: transactions.date,
      payee: transactions.payee,
      notes: transactions.notes,
      originalAmount: transactions.originalAmount,
      originalCurrency: transactions.originalCurrency,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      paidByUserId: transactions.userId,
      paidByName: users.displayName,
    })
    .from(transactionShares)
    .innerJoin(transactions, eq(transactions.id, transactionShares.transactionId))
    .innerJoin(users, eq(users.id, transactions.userId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactionShares.householdId, householdId),
        isNull(transactionShares.deletedAt),
        isNull(transactions.deletedAt),
        filters.from ? gte(transactions.date, filters.from) : undefined,
        filters.to ? lte(transactions.date, filters.to) : undefined,
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];
  const splits = await db
    .select({
      shareId: transactionShareSplits.shareId,
      userId: transactionShareSplits.userId,
      shareCents: transactionShareSplits.shareCents,
    })
    .from(transactionShareSplits)
    .where(
      inArray(
        transactionShareSplits.shareId,
        rows.map((r) => r.shareId),
      ),
    );
  const splitsByShare = new Map<string, { userId: string; shareCents: number }[]>();
  for (const s of splits) {
    const list = splitsByShare.get(s.shareId) ?? [];
    list.push({ userId: s.userId, shareCents: s.shareCents });
    splitsByShare.set(s.shareId, list);
  }
  return rows.map((r) => ({
    ...r,
    currency: r.currency.trim(),
    originalCurrency: r.originalCurrency?.trim() ?? null,
    splits: splitsByShare.get(r.shareId) ?? [],
  }));
}

export type SharedTransactionRow = Awaited<ReturnType<typeof listSharedTransactions>>[number];

/** Household totals in the household's base currency: by category name, by
 *  payer, and net balance per member (paid − own share). Uses each
 *  transaction's fx_rate_to_base only when the payer's base currency equals
 *  the household's; otherwise the caller passes a rate resolver. */
export async function summarizeHousehold(
  householdId: string,
  rows: SharedTransactionRow[],
  baseCurrency: string,
  rateFor: (date: string, from: string, to: string) => Promise<number | null>,
) {
  const members = await listMembers(householdId);
  const byCategory = new Map<string, { icon: string | null; cents: number }>();
  const paidBy = new Map<string, number>();
  const owed = new Map<string, number>();
  let pendingRateCount = 0;

  for (const r of rows) {
    if (r.type === "transfer") continue;
    const sign = r.type === "expense" ? 1 : -1;
    const rate =
      r.currency === baseCurrency ? 1 : await rateFor(r.date, r.currency, baseCurrency);
    if (rate == null) {
      pendingRateCount++;
      continue;
    }
    const cents = toCents(r.amount, r.currency);
    const base = toBaseCents(cents, r.currency, String(rate), baseCurrency) * sign;

    const key = r.categoryName ?? "Uncategorized";
    const cat = byCategory.get(key) ?? { icon: r.categoryIcon, cents: 0 };
    cat.cents += base;
    byCategory.set(key, cat);

    paidBy.set(r.paidByUserId, (paidBy.get(r.paidByUserId) ?? 0) + base);
    for (const s of r.splits) {
      const shareBase = toBaseCents(s.shareCents, r.currency, String(rate), baseCurrency) * sign;
      owed.set(s.userId, (owed.get(s.userId) ?? 0) + shareBase);
    }
  }

  const balances = members.map((m) => ({
    userId: m.id,
    displayName: m.displayName,
    paidCents: paidBy.get(m.id) ?? 0,
    shareCents: owed.get(m.id) ?? 0,
    netCents: (paidBy.get(m.id) ?? 0) - (owed.get(m.id) ?? 0),
  }));
  const totalCents = [...paidBy.values()].reduce((a, b) => a + b, 0);

  return {
    baseCurrency,
    totalCents,
    byCategory: [...byCategory.entries()]
      .map(([name, v]) => ({ name, icon: v.icon, cents: v.cents }))
      .sort((a, b) => b.cents - a.cents),
    balances,
    pendingRateCount,
  };
}

// ---------------------------------------------------------------------------
// Wallet capture (experimental) — already user-scoped.
// ---------------------------------------------------------------------------

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
