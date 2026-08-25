import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { budgets, categories, transactions } from "@/db/schema";
import { decimalsFor, toCents } from "@/lib/domain/money";
import { getRate } from "@/lib/fx";
import { listAccountsWithBalances } from "@/lib/queries";

// Personal-ledger aggregates for the dashboard and budgets (Phase 1.6).
// Everything is scoped by user_id; transfers are always excluded. Base-
// currency amounts use each row's snapshotted fx_rate_to_base; rows without a
// rate are counted in `pendingRateCount` and excluded from base totals.

export function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

/** numeric "base units" string (amount × rate) → base minor units. */
function baseUnitsToCents(units: string | null, baseCurrency: string) {
  if (units == null) return 0;
  return Math.round(Number(units) * 10 ** decimalsFor(baseCurrency));
}

export interface PeriodTotals {
  baseCurrency: string;
  expenseCents: number;
  incomeCents: number;
  netCents: number;
  pendingRateCount: number;
  byCurrency: { currency: string; expenseCents: number; incomeCents: number }[];
}

/** Income/expense totals for a date range (inclusive; omit for all time). */
export async function periodTotals(
  userId: string,
  baseCurrency: string,
  range?: { from: string; to: string },
): Promise<PeriodTotals> {
  const where = and(
    eq(transactions.userId, userId),
    isNull(transactions.deletedAt),
    sql`${transactions.type} <> 'transfer'`,
    range ? gte(transactions.date, range.from) : undefined,
    range ? lte(transactions.date, range.to) : undefined,
  );

  const rows = await db
    .select({
      type: transactions.type,
      currency: transactions.currency,
      nativeSum: sql<string>`sum(${transactions.amount})`,
      baseSum: sql<string | null>`sum(${transactions.amount} * ${transactions.fxRateToBase})`,
      pending: sql<number>`count(*) filter (where ${transactions.fxRateToBase} is null)`,
    })
    .from(transactions)
    .where(where)
    .groupBy(transactions.type, transactions.currency);

  const byCurrency = new Map<string, { expenseCents: number; incomeCents: number }>();
  let expenseCents = 0;
  let incomeCents = 0;
  let pendingRateCount = 0;
  for (const r of rows) {
    const currency = r.currency.trim();
    const bucket = byCurrency.get(currency) ?? { expenseCents: 0, incomeCents: 0 };
    const native = toCents(r.nativeSum, currency);
    const base = baseUnitsToCents(r.baseSum, baseCurrency);
    if (r.type === "expense") {
      bucket.expenseCents += native;
      expenseCents += base;
    } else {
      bucket.incomeCents += native;
      incomeCents += base;
    }
    byCurrency.set(currency, bucket);
    pendingRateCount += Number(r.pending);
  }
  return {
    baseCurrency,
    expenseCents,
    incomeCents,
    netCents: incomeCents - expenseCents,
    pendingRateCount,
    byCurrency: [...byCurrency.entries()]
      .map(([currency, v]) => ({ currency, ...v }))
      .sort((a, b) => b.expenseCents - a.expenseCents),
  };
}

export interface CategoryTotal {
  categoryId: string | null; // null = uncategorized
  name: string;
  icon: string | null;
  cents: number; // base currency
  pendingRateCount: number;
  children: { categoryId: string; name: string; icon: string | null; cents: number }[];
}

/** Base-currency totals per category for one type, children rolled up into
 *  their parent, sorted descending. */
export async function totalsByCategory(
  userId: string,
  baseCurrency: string,
  type: "expense" | "income",
  range?: { from: string; to: string },
): Promise<CategoryTotal[]> {
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      baseSum: sql<string | null>`sum(${transactions.amount} * ${transactions.fxRateToBase})`,
      pending: sql<number>`count(*) filter (where ${transactions.fxRateToBase} is null)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        eq(transactions.type, type),
        range ? gte(transactions.date, range.from) : undefined,
        range ? lte(transactions.date, range.to) : undefined,
      ),
    )
    .groupBy(transactions.categoryId);

  const cats = await db.query.categories.findMany({
    where: and(eq(categories.userId, userId), isNull(categories.deletedAt)),
  });
  const byId = new Map(cats.map((c) => [c.id, c]));

  const parents = new Map<string | null, CategoryTotal>();
  const ensureParent = (id: string | null): CategoryTotal => {
    let p = parents.get(id);
    if (!p) {
      const c = id ? byId.get(id) : undefined;
      p = {
        categoryId: id,
        name: c?.name ?? "Uncategorized",
        icon: c?.icon ?? null,
        cents: 0,
        pendingRateCount: 0,
        children: [],
      };
      parents.set(id, p);
    }
    return p;
  };

  for (const r of rows) {
    const cents = baseUnitsToCents(r.baseSum, baseCurrency);
    const c = r.categoryId ? byId.get(r.categoryId) : undefined;
    const parentId = c?.parentId ?? (c ? c.id : null);
    const parent = ensureParent(parentId);
    parent.cents += cents;
    parent.pendingRateCount += Number(r.pending);
    if (c && c.parentId) {
      parent.children.push({ categoryId: c.id, name: c.name, icon: c.icon, cents });
    }
  }
  for (const p of parents.values()) p.children.sort((a, b) => b.cents - a.cents);
  return [...parents.values()].filter((p) => p.cents !== 0 || p.pendingRateCount > 0).sort((a, b) => b.cents - a.cents);
}

export interface MonthPoint {
  month: string; // YYYY-MM
  expenseCents: number;
  incomeCents: number;
  pendingRateCount: number;
}

/** Last `count` months (oldest first) of base-currency income/expense. */
export async function monthlyTrend(
  userId: string,
  baseCurrency: string,
  count = 12,
  endMonth = currentMonth(),
): Promise<MonthPoint[]> {
  const startMonth = shiftMonth(endMonth, -(count - 1));
  const { from } = monthBounds(startMonth);
  const { to } = monthBounds(endMonth);

  const rows = await db
    .select({
      month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`,
      type: transactions.type,
      baseSum: sql<string | null>`sum(${transactions.amount} * ${transactions.fxRateToBase})`,
      pending: sql<number>`count(*) filter (where ${transactions.fxRateToBase} is null)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        sql`${transactions.type} <> 'transfer'`,
        gte(transactions.date, from),
        lte(transactions.date, to),
      ),
    )
    .groupBy(sql`1`, transactions.type);

  const points = new Map<string, MonthPoint>();
  for (let i = 0; i < count; i++) {
    const m = shiftMonth(startMonth, i);
    points.set(m, { month: m, expenseCents: 0, incomeCents: 0, pendingRateCount: 0 });
  }
  for (const r of rows) {
    const p = points.get(r.month);
    if (!p) continue;
    const cents = baseUnitsToCents(r.baseSum, baseCurrency);
    if (r.type === "expense") p.expenseCents += cents;
    else p.incomeCents += cents;
    p.pendingRateCount += Number(r.pending);
  }
  return [...points.values()];
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export interface BudgetRow {
  categoryId: string;
  name: string;
  icon: string | null;
  parentId: string | null;
  budgetId: string | null;
  budgetCents: number | null; // base currency
  actualCents: number; // base currency, this category only (no roll-up)
}

/** Every expense-relevant category with its budget (if any) and actual spend
 *  for the month, in the user's base currency. Actuals are per category
 *  (children not rolled into parents) so a parent budget and a child budget
 *  can coexist without double counting. */
export async function budgetsForMonth(
  userId: string,
  baseCurrency: string,
  month: string,
): Promise<BudgetRow[]> {
  const range = monthBounds(month);
  const [cats, budgetRows, actuals] = await Promise.all([
    db.query.categories.findMany({
      where: and(eq(categories.userId, userId), isNull(categories.deletedAt)),
      orderBy: [categories.sortOrder, categories.name],
    }),
    db.query.budgets.findMany({
      where: and(
        eq(budgets.userId, userId),
        eq(budgets.month, range.from),
        isNull(budgets.deletedAt),
      ),
    }),
    db
      .select({
        categoryId: transactions.categoryId,
        baseSum: sql<string | null>`sum(${transactions.amount} * ${transactions.fxRateToBase})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          eq(transactions.type, "expense"),
          gte(transactions.date, range.from),
          lte(transactions.date, range.to),
        ),
      )
      .groupBy(transactions.categoryId),
  ]);

  const budgetByCat = new Map(budgetRows.map((b) => [b.categoryId, b]));
  const actualByCat = new Map(
    actuals.map((a) => [a.categoryId, baseUnitsToCents(a.baseSum, baseCurrency)]),
  );

  // Parents first, children indented after their parent.
  const parents = cats.filter((c) => !c.parentId);
  const childrenOf = (id: string) => cats.filter((c) => c.parentId === id);
  const ordered = parents.flatMap((p) => [p, ...childrenOf(p.id)]);

  return ordered.map((c) => {
    const b = budgetByCat.get(c.id);
    return {
      categoryId: c.id,
      name: c.name,
      icon: c.icon,
      parentId: c.parentId,
      budgetId: b?.id ?? null,
      budgetCents: b ? toCents(b.amount, baseCurrency) : null,
      actualCents: actualByCat.get(c.id) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Net worth — account balances grouped by currency, converted to base at the
// latest known rate.
// ---------------------------------------------------------------------------

export interface CurrencyGroup {
  currency: string;
  totalCents: number; // native
  baseCents: number | null; // null when no rate is known
  accounts: {
    id: string;
    name: string;
    type: string;
    balanceCents: number;
    baseCents: number | null;
    archived: boolean;
  }[];
}

export async function netWorth(userId: string, baseCurrency: string) {
  const accounts = (await listAccountsWithBalances(userId)).filter((a) => !a.archived);
  const today = new Date().toISOString().slice(0, 10);
  const currencies = [...new Set(accounts.map((a) => a.currency))];
  const rates = new Map<string, number | null>();
  for (const c of currencies) {
    rates.set(c, c === baseCurrency ? 1 : await getRate(today, c, baseCurrency));
  }
  const toBase = (cents: number, currency: string) => {
    const rate = rates.get(currency);
    if (rate == null) return null;
    return Math.round(
      (cents / 10 ** decimalsFor(currency)) * rate * 10 ** decimalsFor(baseCurrency),
    );
  };

  const groups: CurrencyGroup[] = currencies.map((currency) => {
    const rows = accounts
      .filter((a) => a.currency === currency)
      .map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        balanceCents: a.balanceCents,
        baseCents: toBase(a.balanceCents, currency),
        archived: a.archived,
      }));
    const totalCents = rows.reduce((s, r) => s + r.balanceCents, 0);
    return { currency, totalCents, baseCents: toBase(totalCents, currency), accounts: rows };
  });
  groups.sort((a, b) => (b.baseCents ?? 0) - (a.baseCents ?? 0));

  const missingRate = groups.some((g) => g.baseCents == null);
  const totalBaseCents = groups.reduce((s, g) => s + (g.baseCents ?? 0), 0);
  return { baseCurrency, totalBaseCents, missingRate, groups };
}
