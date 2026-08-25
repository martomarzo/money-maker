import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listTransactions } from "@/lib/queries";
import { formatCents } from "@/lib/domain/money";
import {
  currentMonth,
  isMonth,
  monthBounds,
  monthlyTrend,
  netWorth,
  periodTotals,
  shiftMonth,
  totalsByCategory,
} from "@/lib/reports";
import { TransactionRowItem } from "@/components/transaction-row";
import { Badge, ButtonLink, Card, CardTitle, EmptyState } from "@/components/ui";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { CategoryBars } from "@/components/dashboard/category-bars";
import { TrendChart } from "@/components/dashboard/trend-chart";

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const { month: rawMonth } = await searchParams;
  const { userId, displayName, baseCurrency } = await requireUser();

  const nowMonth = currentMonth();
  const allTime = rawMonth === "all";
  const month = isMonth(rawMonth) ? rawMonth : nowMonth;
  const range = allTime ? undefined : monthBounds(month);

  const monthLabel = allTime
    ? "All time"
    : new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
        new Date(`${month}-01T00:00:00Z`),
      );

  const [wealth, recent, totals, expenseByCategory, incomeByCategory, trend] = await Promise.all([
    netWorth(userId, baseCurrency),
    listTransactions(userId, {}, 8),
    periodTotals(userId, baseCurrency, range),
    totalsByCategory(userId, baseCurrency, "expense", range),
    totalsByCategory(userId, baseCurrency, "income", range),
    monthlyTrend(userId, baseCurrency, 12),
  ]);

  const accountCount = wealth.groups.reduce((n, g) => n + g.accounts.length, 0);
  const hasIncome = incomeByCategory.length > 0;

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Hero: primary action */}
      <section className="flex flex-col gap-4 rounded-2xl bg-accent px-5 py-6 text-on-accent">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wider opacity-80">
            {displayName} · {baseCurrency}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            What did you spend?
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink
            href="/add"
            size="lg"
            className="!bg-on-accent !text-accent-strong hover:!bg-white/90"
          >
            <span className="text-lg leading-none">+</span> Add expense
          </ButtonLink>
          <ButtonLink
            href="/transactions/new?type=income"
            size="lg"
            className="!bg-white/15 !text-on-accent hover:!bg-white/25"
          >
            Add income
          </ButtonLink>
          <ButtonLink
            href="/transactions/new?type=transfer"
            size="lg"
            className="!bg-white/15 !text-on-accent hover:!bg-white/25"
          >
            Transfer
          </ButtonLink>
        </div>
      </section>

      {/* Net worth: every account, grouped by currency */}
      <Card className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Your money</CardTitle>
            <span
              className={`tnum text-4xl font-semibold tracking-tight sm:text-5xl ${
                wealth.totalBaseCents < 0 ? "text-expense" : ""
              }`}
            >
              {formatCents(wealth.totalBaseCents, baseCurrency)}
            </span>
            <span className="text-xs text-muted">
              {accountCount} account{accountCount === 1 ? "" : "s"} · {wealth.groups.length}{" "}
              currenc{wealth.groups.length === 1 ? "y" : "ies"} · in {baseCurrency} at today&apos;s rate
              {wealth.missingRate && (
                <span className="text-warning"> · some balances lack an FX rate</span>
              )}
            </span>
          </div>
          <ButtonLink href="/accounts" variant="ghost" size="sm">
            Manage
          </ButtonLink>
        </div>

        {accountCount === 0 ? (
          <EmptyState
            title="No accounts yet"
            description="Add a bank account, card or cash wallet to start logging."
            action={
              <ButtonLink href="/accounts/new" size="sm">
                Add account
              </ButtonLink>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {wealth.groups.map((g) => (
              <div key={g.currency} className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted/60 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Badge tone="accent">{g.currency}</Badge>
                    {g.currency !== baseCurrency && g.baseCents != null && (
                      <span className="tnum text-xs text-muted">≈ {formatCents(g.baseCents, baseCurrency)}</span>
                    )}
                  </span>
                  <span className={`tnum text-base font-semibold ${g.totalCents < 0 ? "text-expense" : ""}`}>
                    {formatCents(g.totalCents, g.currency)}
                  </span>
                </div>
                <ul className="flex flex-col divide-y divide-border">
                  {g.accounts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                      <Link href={`/accounts/${a.id}/edit`} className="flex min-w-0 flex-col hover:underline">
                        <span className="truncate font-medium">{a.name}</span>
                        <span className="text-[11px] capitalize text-faint">{a.type.replace("_", " ")}</span>
                      </Link>
                      <span className={`tnum shrink-0 font-semibold ${a.balanceCents < 0 ? "text-expense" : ""}`}>
                        {formatCents(a.balanceCents, g.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Month selector */}
      <div className="flex items-center gap-2">
        <Link
          href={`/?month=${shiftMonth(allTime ? nowMonth : month, -1)}`}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-muted"
          aria-label="Previous month"
        >
          ‹
        </Link>
        <span className="min-w-36 text-center text-sm font-medium">{monthLabel}</span>
        <Link
          href={`/?month=${shiftMonth(allTime ? nowMonth : month, 1)}`}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-muted"
          aria-label="Next month"
        >
          ›
        </Link>
        <Link
          href={`/?month=${allTime ? nowMonth : "all"}`}
          className="ml-auto text-xs font-medium text-muted hover:text-foreground"
        >
          {allTime ? "This month" : "All time"}
        </Link>
      </div>

      {/* KPIs */}
      <KpiRow totals={totals} />

      {/* Category breakdowns */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CategoryBars
            title="Where it went"
            totals={expenseByCategory}
            baseCurrency={baseCurrency}
            markClass="bg-chart-expense"
            range={range}
            emptyLabel="No expenses in this period"
          />
        </Card>
        {hasIncome && (
          <Card>
            <CategoryBars
              title="Where it came from"
              totals={incomeByCategory}
              baseCurrency={baseCurrency}
              markClass="bg-chart-income"
              range={range}
              emptyLabel="No income in this period"
            />
          </Card>
        )}
      </div>

      {/* Trend */}
      <Card className="flex flex-col gap-3">
        <CardTitle>Last 12 months</CardTitle>
        <TrendChart points={trend} baseCurrency={baseCurrency} />
      </Card>

      <div className="grid gap-6">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <CardTitle>Recent</CardTitle>
            <ButtonLink href="/transactions" variant="ghost" size="sm">
              View all
            </ButtonLink>
          </div>
          {recent.length === 0 ? (
            <EmptyState
              title="Nothing logged yet"
              description="Your latest expenses and income will show up here."
              action={
                <ButtonLink href="/add" size="sm">
                  Add expense
                </ButtonLink>
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {recent.map((row) => (
                <li key={row.transaction.id}>
                  <TransactionRowItem row={row} showDate />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
