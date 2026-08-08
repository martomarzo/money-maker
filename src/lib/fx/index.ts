import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { fxRates, households, transactions } from "@/db/schema";

// Provider: open.er-api.com — free, keyless, daily rates, covers ARS/PYG.
// We store rates pivoted on EUR: (date, 'EUR', X, rate). Any X→Y rate is
// derived as (EUR→Y)/(EUR→X), so a household's base currency can change
// without refetching anything.

export const SUPPORTED_CURRENCIES = ["EUR", "USD", "ARS", "PYG"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

const PIVOT = "EUR";

export async function fetchAndStoreLatestRates(): Promise<void> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${PIVOT}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`FX fetch failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    result: string;
    rates?: Record<string, number>;
  };
  if (body.result !== "success" || !body.rates) {
    throw new Error(`FX fetch failed: ${JSON.stringify(body).slice(0, 200)}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = SUPPORTED_CURRENCIES.filter((c) => body.rates![c] != null).map(
    (c) => ({
      date: today,
      fromCurrency: PIVOT,
      toCurrency: c,
      rate: String(body.rates![c]),
    }),
  );
  if (rows.length === 0) return;

  await db
    .insert(fxRates)
    .values(rows)
    .onConflictDoUpdate({
      target: [fxRates.date, fxRates.fromCurrency, fxRates.toCurrency],
      set: { rate: sql`excluded.rate`, fetchedAt: sql`now()` },
    });
}

/** EUR→currency rate on the best-known date for `date`: exact, else latest
 *  before, else earliest after. Null if we have no rates at all. */
async function pivotRateFor(date: string, currency: string): Promise<number | null> {
  if (currency === PIVOT) return 1;
  const onOrBefore = await db.query.fxRates.findFirst({
    where: and(
      eq(fxRates.fromCurrency, PIVOT),
      eq(fxRates.toCurrency, currency),
      lte(fxRates.date, date),
    ),
    orderBy: desc(fxRates.date),
  });
  if (onOrBefore) return Number(onOrBefore.rate);
  const earliestAfter = await db.query.fxRates.findFirst({
    where: and(
      eq(fxRates.fromCurrency, PIVOT),
      eq(fxRates.toCurrency, currency),
      gte(fxRates.date, date),
    ),
    orderBy: fxRates.date,
  });
  return earliestAfter ? Number(earliestAfter.rate) : null;
}

/** Rate multiplying an amount in `from` to get `to`, for the given ISO date.
 *  Null when no rates are cached yet (offline-created rows get backfilled). */
export async function getRate(
  date: string,
  from: string,
  to: string,
): Promise<number | null> {
  if (from === to) return 1;
  const [eurToTarget, eurToSource] = await Promise.all([
    pivotRateFor(date, to),
    pivotRateFor(date, from),
  ]);
  if (eurToTarget == null || eurToSource == null || eurToSource === 0) {
    return null;
  }
  return eurToTarget / eurToSource;
}

/** Fill fx_rate_to_base on transactions that were saved before a rate was
 *  known (e.g. created offline). Run after each rate refresh. */
export async function backfillMissingFxRates(): Promise<number> {
  const missing = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      currency: transactions.currency,
      baseCurrency: households.baseCurrency,
    })
    .from(transactions)
    .innerJoin(households, eq(transactions.householdId, households.id))
    .where(and(isNull(transactions.fxRateToBase), isNull(transactions.deletedAt)))
    .limit(500);

  let updated = 0;
  for (const row of missing) {
    const rate = await getRate(row.date, row.currency.trim(), row.baseCurrency.trim());
    if (rate == null) continue;
    await db
      .update(transactions)
      .set({ fxRateToBase: rate.toFixed(8), updatedAt: new Date() })
      .where(eq(transactions.id, row.id));
    updated++;
  }
  return updated;
}
