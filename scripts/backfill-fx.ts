/**
 * One-time historical FX backfill.
 *
 * Populates `fx_rates` (EUR-pivoted, see src/lib/fx/index.ts) for the range
 * 2023-12-01..today, so historical transactions get an accurate
 * fx_rate_to_base instead of leaning on getRate()'s nearest-date fallback
 * across a huge gap. This script is meant to be run once (then rely on
 * fetchAndStoreLatestRates()'s daily refresh going forward).
 *
 * Design note shared with src/lib/fx/index.ts: we only ever store rows for
 * dates a source actually published a quote for. Nothing here forward-fills
 * weekends/holidays — getRate()'s nearest-date lookup is what covers gaps at
 * read time.
 *
 * Sources
 * -------
 * EUR→USD  Frankfurter (https://api.frankfurter.dev/v1), ECB reference
 *          rates. Free, keyless. Published on ECB business days only
 *          (~250/yr). Verified with curl: a single request for the full
 *          2023-12-01..today range returns ~700 dated rows; we still chunk
 *          by calendar year defensively in case the range is ever rejected.
 *          (Note: api.frankfurter.app 301-redirects to api.frankfurter.dev —
 *          we call the .dev host directly.)
 *
 * EUR→ARS  Composed as EUR→USD(nearest ECB date ≤ d) × USD→ARS(d), where
 *          USD→ARS(d) comes from BCRA's official, free, keyless
 *          "Cotizaciones" API (https://api.bcra.gob.ar/estadisticascambiarias).
 *          BCRA publishes on Argentine business days, which differ from ECB
 *          business days, hence joining on "nearest EUR→USD on or before d"
 *          rather than requiring an exact date match. Verified with curl:
 *          the full range returns 650 rows in one paginated call (BCRA caps
 *          `limit` at 1000; we paginate via `offset` defensively). The data
 *          clearly reflects the real Dec-2023 official-rate devaluation
 *          (~366 → ~800 ARS/USD in mid-December 2023), which is a reasonable
 *          plausibility check that this is genuine BCRA data.
 *
 * EUR→PYG  No free, historical, keyless official source was found: BCP
 *          Paraguay's site (bcp.gov.py) returns HTTP 403 to unauthenticated
 *          clients (Cloudflare bot protection) even with a browser
 *          User-Agent, and every dedicated FX-history API tried
 *          (exchangerate.host, freecurrencyapi.com, currencybeacon.com,
 *          v6.exchangerate-api.com) requires a paid API key. open.er-api.com
 *          (used by fetchAndStoreLatestRates for *today's* rate) has no
 *          historical endpoint at all on its free tier.
 *
 *          fxratesapi.com (https://api.fxratesapi.com) is free, keyless, and
 *          returns *direct* EUR-pivoted rates (no USD composition needed).
 *          Verified with curl. Its free tier restricts the bulk
 *          `/timeseries` endpoint to the trailing 366 days
 *          ("start_date_too_old" for anything older, regardless of
 *          resolution) — for that window we fetch daily via one bulk
 *          request. For dates older than that we fall back to its per-day
 *          `/historical` endpoint, sampled roughly weekly (not daily) to
 *          stay a reasonable citizen of a free unauthenticated API — this
 *          means PYG coverage is sparser (~7-day gaps) before ~13 months
 *          ago than EUR/USD or EUR/ARS. These are still real quotes for the
 *          sampled dates, not synthesized/forward-filled values. If
 *          fxratesapi.com is unreachable, PYG is skipped gracefully with a
 *          warning (USD/ARS still get written) — the app's getRate()
 *          nearest-date fallback continues to work, just with less
 *          precision, for any household whose base or transaction currency
 *          is PYG until a later run fills it in.
 *
 * Usage
 * -----
 *   npm run fx:backfill -- --dry-run [--from=2023-12-01] [--to=2026-08-08]
 *   npm run fx:backfill                # writes to DB via DATABASE_URL
 *
 * --dry-run fetches + validates + prints per-currency counts, date
 * coverage, largest gap, and min/max rate; it makes NO database writes and
 * never even imports the db client, so it works with no DATABASE_URL / no
 * live Postgres available.
 */

const PIVOT = "EUR";
const DEFAULT_FROM = "2023-12-01";
const DENSE_WINDOW_DAYS = 365; // fxratesapi free-tier /timeseries limit
const SPARSE_STEP_DAYS = 7;
const DB_BATCH_SIZE = 500;
const PYG_CONCURRENCY = 5;

export type RatePoint = { date: string; rate: number };

// ---------------------------------------------------------------------------
// Date helpers (plain ISO "YYYY-MM-DD" strings, UTC-based to avoid TZ bugs)
// ---------------------------------------------------------------------------

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db_ = Date.UTC(by, bm - 1, bd);
  return Math.round((db_ - da) / 86_400_000);
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}
function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

/** Split [from,to] into calendar-year chunks: [["2023-12-01","2023-12-31"], ["2024-01-01","2024-12-31"], ...]. */
export function splitByYear(from: string, to: string): [string, string][] {
  const chunks: [string, string][] = [];
  let curFrom = from;
  while (curFrom <= to) {
    const yearEnd = `${curFrom.slice(0, 4)}-12-31`;
    const curTo = minDate(yearEnd, to);
    chunks.push([curFrom, curTo]);
    curFrom = addDays(curTo, 1);
  }
  return chunks;
}

/** Sort ascending by date and drop duplicate dates (keeping the last seen). */
export function dedupeSorted(points: RatePoint[]): RatePoint[] {
  const byDate = new Map<string, number>();
  for (const p of points) byDate.set(p.date, p.rate);
  return [...byDate.entries()]
    .map(([date, rate]) => ({ date, rate }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Latest point with date <= target, assuming `sorted` is ascending by date. */
export function nearestOnOrBefore(
  sorted: RatePoint[],
  date: string,
): RatePoint | undefined {
  let result: RatePoint | undefined;
  for (const p of sorted) {
    if (p.date <= date) result = p;
    else break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Frankfurter (ECB) — EUR→USD
// ---------------------------------------------------------------------------

type FrankfurterResponse = {
  amount: number;
  base: string;
  start_date: string;
  end_date: string;
  rates: Record<string, Record<string, number>>;
};

export function parseFrankfurterTimeseries(
  body: FrankfurterResponse,
  target: string,
): RatePoint[] {
  return Object.entries(body.rates ?? {})
    .map(([date, rates]) => ({ date, rate: rates[target] }))
    .filter((p): p is RatePoint => typeof p.rate === "number")
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchFrankfurterRange(
  from: string,
  to: string,
  target: string,
): Promise<RatePoint[]> {
  const chunks = splitByYear(from, to);
  const all: RatePoint[] = [];
  for (const [chFrom, chTo] of chunks) {
    const url = `https://api.frankfurter.dev/v1/${chFrom}..${chTo}?from=${PIVOT}&to=${target}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      throw new Error(
        `Frankfurter fetch failed: HTTP ${res.status} for ${chFrom}..${chTo}`,
      );
    }
    const body = (await res.json()) as FrankfurterResponse;
    all.push(...parseFrankfurterTimeseries(body, target));
  }
  return dedupeSorted(all);
}

// ---------------------------------------------------------------------------
// BCRA — USD→ARS, composed into EUR→ARS
// ---------------------------------------------------------------------------

type BcraResponse = {
  status: number;
  metadata?: { resultset: { count: number; offset: number; limit: number } };
  results?: {
    fecha: string;
    detalle: { codigoMoneda: string; tipoCotizacion: number }[];
  }[];
  errorMessages?: string[];
};

export function parseBcraResponse(body: BcraResponse): RatePoint[] {
  return (body.results ?? [])
    .map((r) => {
      const detail = r.detalle.find((d) => d.codigoMoneda === "USD");
      return detail && detail.tipoCotizacion > 0
        ? { date: r.fecha, rate: detail.tipoCotizacion }
        : null;
    })
    .filter((p): p is RatePoint => p !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchBcraUsdArs(
  from: string,
  to: string,
): Promise<RatePoint[]> {
  const all: RatePoint[] = [];
  const limit = 1000;
  let offset = 0;
  for (let iter = 0; iter < 20; iter++) {
    const url =
      `https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD` +
      `?fechadesde=${from}&fechahasta=${to}&offset=${offset}&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      throw new Error(`BCRA fetch failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as BcraResponse;
    if (body.status !== 200) {
      throw new Error(
        `BCRA fetch failed: ${(body.errorMessages ?? []).join("; ")}`,
      );
    }
    all.push(...parseBcraResponse(body));
    const rs = body.metadata?.resultset;
    if (!rs) break;
    const nextOffset = rs.offset + rs.limit;
    if (nextOffset >= rs.count || rs.limit === 0) break;
    offset = nextOffset;
  }
  return dedupeSorted(all);
}

/**
 * EUR→ARS(d) = EUR→USD(nearest ECB date <= d) * USD→ARS(d).
 * Points whose date is before the earliest EUR→USD quote are dropped (no
 * rate to compose with).
 */
export function composeEurArs(
  eurUsd: RatePoint[],
  usdArs: RatePoint[],
): RatePoint[] {
  const sortedEurUsd = [...eurUsd].sort((a, b) => a.date.localeCompare(b.date));
  const composed: RatePoint[] = [];
  for (const point of usdArs) {
    const pivot = nearestOnOrBefore(sortedEurUsd, point.date);
    if (!pivot) continue;
    composed.push({ date: point.date, rate: pivot.rate * point.rate });
  }
  return dedupeSorted(composed);
}

// ---------------------------------------------------------------------------
// fxratesapi.com — EUR→PYG (direct, EUR-pivoted)
// ---------------------------------------------------------------------------

type FxratesapiHistoricalResponse = {
  success: boolean;
  date: string; // e.g. "2024-01-01T23:59:00.000Z"
  rates: Record<string, number>;
};

type FxratesapiTimeseriesResponse = {
  success: boolean;
  rates: Record<string, Record<string, number>>; // keyed by ISO datetime
};

export function parseFxratesapiHistorical(
  body: FxratesapiHistoricalResponse,
  currency: string,
): RatePoint | null {
  if (!body.success || typeof body.rates?.[currency] !== "number") return null;
  return { date: body.date.slice(0, 10), rate: body.rates[currency] };
}

export function parseFxratesapiTimeseries(
  body: FxratesapiTimeseriesResponse,
  currency: string,
): RatePoint[] {
  if (!body.success) return [];
  return Object.entries(body.rates ?? {})
    .map(([dt, rates]) => ({ date: dt.slice(0, 10), rate: rates[currency] }))
    .filter((p): p is RatePoint => typeof p.rate === "number")
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchFxratesapiTimeseries(
  from: string,
  to: string,
  currency: string,
): Promise<RatePoint[]> {
  const url = `https://api.fxratesapi.com/timeseries?start_date=${from}&end_date=${to}&base=${PIVOT}&currencies=${currency}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`fxratesapi timeseries failed: HTTP ${res.status}`);
  const body = (await res.json()) as FxratesapiTimeseriesResponse;
  return parseFxratesapiTimeseries(body, currency);
}

export async function fetchFxratesapiHistoricalDay(
  date: string,
  currency: string,
): Promise<RatePoint | null> {
  const url = `https://api.fxratesapi.com/historical?date=${date}&base=${PIVOT}&currencies=${currency}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const body = (await res.json()) as FxratesapiHistoricalResponse;
  return parseFxratesapiHistorical(body, currency);
}

/**
 * Splits [from,to] into a "dense" sub-range (last DENSE_WINDOW_DAYS days,
 * fetched daily via one bulk /timeseries call) and a list of individual
 * dates in the older, "sparse" sub-range (fetched one at a time via
 * /historical, spaced SPARSE_STEP_DAYS apart, always including the sparse
 * range's last day so the join with the dense range has a bounded gap).
 */
export function planPygFetch(
  from: string,
  to: string,
  today: string,
  denseWindowDays = DENSE_WINDOW_DAYS,
  sparseStepDays = SPARSE_STEP_DAYS,
): { dense: [string, string] | null; sparseDates: string[] } {
  const cutoff = addDays(today, -denseWindowDays);

  const denseFrom = maxDate(from, cutoff);
  const denseTo = minDate(to, today);
  const dense: [string, string] | null =
    denseFrom <= denseTo ? [denseFrom, denseTo] : null;

  const sparseFrom = from;
  const sparseTo = minDate(to, addDays(cutoff, -1));
  const sparseDates: string[] = [];
  if (sparseFrom <= sparseTo) {
    let d = sparseFrom;
    while (d <= sparseTo) {
      sparseDates.push(d);
      d = addDays(d, sparseStepDays);
    }
    if (sparseDates[sparseDates.length - 1] !== sparseTo) {
      sparseDates.push(sparseTo);
    }
  }
  return { dense, sparseDates };
}

export async function fetchPygRates(
  from: string,
  to: string,
  today: string,
): Promise<RatePoint[]> {
  const { dense, sparseDates } = planPygFetch(from, to, today);
  const points: RatePoint[] = [];

  if (dense) {
    points.push(...(await fetchFxratesapiTimeseries(dense[0], dense[1], "PYG")));
  }

  for (let i = 0; i < sparseDates.length; i += PYG_CONCURRENCY) {
    const batch = sparseDates.slice(i, i + PYG_CONCURRENCY);
    const results = await Promise.all(
      batch.map((d) => fetchFxratesapiHistoricalDay(d, "PYG")),
    );
    for (const r of results) if (r) points.push(r);
  }

  return dedupeSorted(points);
}

// ---------------------------------------------------------------------------
// Stats / DB rows
// ---------------------------------------------------------------------------

export type CurrencyStats = {
  count: number;
  firstDate: string;
  lastDate: string;
  maxGapDays: number;
  minRate: number;
  maxRate: number;
};

export function computeStats(points: RatePoint[]): CurrencyStats | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  let maxGapDays = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = daysBetween(sorted[i - 1].date, sorted[i].date);
    if (gap > maxGapDays) maxGapDays = gap;
  }
  const rates = sorted.map((p) => p.rate);
  return {
    count: sorted.length,
    firstDate: sorted[0].date,
    lastDate: sorted[sorted.length - 1].date,
    maxGapDays,
    minRate: Math.min(...rates),
    maxRate: Math.max(...rates),
  };
}

export type FxRateRow = {
  date: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
};

export function toDbRows(currency: string, points: RatePoint[]): FxRateRow[] {
  return points.map((p) => ({
    date: p.date,
    fromCurrency: PIVOT,
    toCurrency: currency,
    rate: p.rate.toFixed(8),
  }));
}

async function upsertBatched(rows: FxRateRow[]): Promise<number> {
  const { db } = await import("../src/db");
  const { fxRates } = await import("../src/db/schema");
  const { sql } = await import("drizzle-orm");

  let written = 0;
  for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
    const batch = rows.slice(i, i + DB_BATCH_SIZE);
    await db
      .insert(fxRates)
      .values(batch)
      .onConflictDoUpdate({
        target: [fxRates.date, fxRates.fromCurrency, fxRates.toCurrency],
        set: { rate: sql`excluded.rate`, fetchedAt: sql`now()` },
      });
    written += batch.length;
  }
  return written;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    if (rest.length > 0) values.set(key, rest.join("="));
    else flags.add(key);
  }
  return { flags, values };
}

function formatStats(stats: CurrencyStats | null): string {
  if (!stats) return "no data";
  return (
    `${stats.count} rates, ${stats.firstDate}..${stats.lastDate}, ` +
    `largest gap ${stats.maxGapDays}d, range ${stats.minRate.toFixed(4)}–${stats.maxRate.toFixed(4)}`
  );
}

function sampleRates(points: RatePoint[], n = 3): string {
  if (points.length === 0) return "(none)";
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const idxs = new Set<number>([
    0,
    Math.floor((sorted.length - 1) / 2),
    sorted.length - 1,
  ]);
  return [...idxs]
    .sort((a, b) => a - b)
    .slice(0, n)
    .map((i) => `${sorted[i].date}=${sorted[i].rate.toFixed(4)}`)
    .join(", ");
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));
  const dryRun = flags.has("dry-run");
  const from = values.get("from") ?? DEFAULT_FROM;
  const to = values.get("to") ?? todayIso();
  const today = todayIso();

  if (from > to) {
    throw new Error(`--from (${from}) must be <= --to (${to})`);
  }

  console.log(`FX backfill ${from}..${to}${dryRun ? " [dry run]" : ""}`);

  console.log("Fetching EUR→USD (Frankfurter/ECB)...");
  const eurUsd = await fetchFrankfurterRange(from, to, "USD");

  console.log("Fetching USD→ARS (BCRA) and composing EUR→ARS...");
  const usdArs = await fetchBcraUsdArs(from, to);
  const eurArs = composeEurArs(eurUsd, usdArs);

  let eurPyg: RatePoint[] = [];
  try {
    console.log("Fetching EUR→PYG (fxratesapi.com)...");
    eurPyg = await fetchPygRates(from, to, today);
  } catch (err) {
    console.warn(
      `PYG backfill skipped (fxratesapi.com unreachable): ${(err as Error).message}`,
    );
  }

  const perCurrency: [string, RatePoint[]][] = [
    ["USD", eurUsd],
    ["ARS", eurArs],
    ["PYG", eurPyg],
  ];

  console.log("\nSummary:");
  for (const [currency, points] of perCurrency) {
    const stats = computeStats(points);
    console.log(`  EUR→${currency}: ${formatStats(stats)}`);
    console.log(`    sample: ${sampleRates(points)}`);
  }

  if (dryRun) {
    console.log("\nDry run complete — no database writes made.");
    return;
  }

  console.log("\nWriting to database...");
  let totalRows = 0;
  for (const [currency, points] of perCurrency) {
    if (points.length === 0) {
      console.log(`  EUR→${currency}: nothing to write`);
      continue;
    }
    const rows = toDbRows(currency, points);
    const n = await upsertBatched(rows);
    console.log(`  EUR→${currency}: upserted ${n} rows`);
    totalRows += n;
  }
  console.log(`\nDone. ${totalRows} rows upserted.`);
  process.exit(0);
}

const isMain = (() => {
  const entry = process.argv[1];
  return !!entry && import.meta.url === `file://${entry}`;
})();

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
