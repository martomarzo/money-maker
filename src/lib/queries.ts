import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, memberships, transactions, users } from "@/db/schema";
import { decimalsFor, toCents } from "@/lib/domain/money";

// Visibility rules (plan §3):
// - Accounts: joint (owner_user_id NULL) or owned by the viewer.
// - Transactions: rows on visible accounts, PLUS rows marked visibility=shared
//   on the partner's personal accounts (household expenses paid from a
//   personal card). The viewer's own personal-visibility rows are included.

export async function listVisibleAccounts(householdId: string, userId: string) {
  return db.query.accounts.findMany({
    where: and(
      eq(accounts.householdId, householdId),
      isNull(accounts.deletedAt),
      or(isNull(accounts.ownerUserId), eq(accounts.ownerUserId, userId)),
    ),
    orderBy: [accounts.archived, accounts.name],
  });
}

/** Visible accounts with current balance in minor units (initial + signed sum). */
export async function listAccountsWithBalances(
  householdId: string,
  userId: string,
) {
  const visible = await listVisibleAccounts(householdId, userId);
  if (visible.length === 0) return [];

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
          visible.map((a) => a.id),
        ),
        isNull(transactions.deletedAt),
      ),
    )
    .groupBy(transactions.accountId);

  const sumByAccount = new Map(sums.map((s) => [s.accountId, s.signedSum]));
  return visible.map((account) => {
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
  createdByUserId?: string;
  type?: "expense" | "income" | "transfer";
  from?: string; // ISO date, inclusive
  to?: string; // ISO date, inclusive
}

export async function listTransactions(
  householdId: string,
  userId: string,
  filters: TransactionFilters = {},
  limit = 200,
) {
  const visibleAccountIds = (await listVisibleAccounts(householdId, userId)).map(
    (a) => a.id,
  );

  const visibilityClause = or(
    visibleAccountIds.length > 0
      ? inArray(transactions.accountId, visibleAccountIds)
      : sql`false`,
    // Shared transactions on the partner's personal accounts.
    eq(transactions.visibility, "shared"),
  );

  const rows = await db
    .select({
      transaction: transactions,
      accountName: accounts.name,
      accountOwnerUserId: accounts.ownerUserId,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      createdByName: users.displayName,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .innerJoin(users, eq(transactions.createdByUserId, users.id))
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
        visibilityClause,
        filters.accountId
          ? eq(transactions.accountId, filters.accountId)
          : undefined,
        filters.categoryId
          ? eq(transactions.categoryId, filters.categoryId)
          : undefined,
        filters.createdByUserId
          ? eq(transactions.createdByUserId, filters.createdByUserId)
          : undefined,
        filters.type ? eq(transactions.type, filters.type) : undefined,
        filters.from ? gte(transactions.date, filters.from) : undefined,
        filters.to ? lte(transactions.date, filters.to) : undefined,
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    transaction: {
      ...r.transaction,
      currency: r.transaction.currency.trim(),
    },
  }));
}

/** Per-currency expense/income totals plus a base-currency total where rates
 *  are known. Transfers are excluded. `pendingRateCount` > 0 means some rows
 *  still await an FX rate and the base total is incomplete. */
export function summarizeTransactions(
  rows: Awaited<ReturnType<typeof listTransactions>>,
  baseCurrency: string,
) {
  const byCurrency = new Map<
    string,
    { expenseCents: number; incomeCents: number }
  >();
  let baseExpenseCents = 0;
  let baseIncomeCents = 0;
  let pendingRateCount = 0;

  for (const { transaction: t } of rows) {
    if (t.type === "transfer") continue;
    const bucket = byCurrency.get(t.currency) ?? {
      expenseCents: 0,
      incomeCents: 0,
    };
    const cents = toCents(t.amount, t.currency);
    if (t.type === "expense") bucket.expenseCents += cents;
    else bucket.incomeCents += cents;
    byCurrency.set(t.currency, bucket);

    if (t.fxRateToBase != null) {
      const baseCents = Math.round(
        (cents / 10 ** decimalsFor(t.currency)) *
          Number(t.fxRateToBase) *
          10 ** decimalsFor(baseCurrency),
      );
      if (t.type === "expense") baseExpenseCents += baseCents;
      else baseIncomeCents += baseCents;
    } else {
      pendingRateCount++;
    }
  }

  return {
    byCurrency,
    baseCurrency,
    baseExpenseCents,
    baseIncomeCents,
    pendingRateCount,
  };
}

export async function listCategories(householdId: string) {
  return db.query.categories.findMany({
    where: and(eq(categories.householdId, householdId), isNull(categories.deletedAt)),
    orderBy: [categories.sortOrder, categories.name],
  });
}

export async function listMembers(householdId: string) {
  return db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .innerJoin(
      memberships,
      and(
        eq(memberships.userId, users.id),
        eq(memberships.householdId, householdId),
      ),
    );
}
