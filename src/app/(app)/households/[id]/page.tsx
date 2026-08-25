import Link from "next/link";
import { requireHouseholdMember } from "@/lib/session";
import { listMembers, listSharedTransactions, summarizeHousehold } from "@/lib/queries";
import { getRate } from "@/lib/fx";
import { formatCents, toCents } from "@/lib/domain/money";
import { ButtonLink, Card, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { formatDateHeading } from "@/components/transaction-row";

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${month}-${String(last).padStart(2, "0")}` };
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function HouseholdPage({
  params,
  searchParams,
}: PageProps<"/households/[id]">) {
  const { id } = await params;
  const { month: rawMonth } = await searchParams;
  const { userId, household } = await requireHouseholdMember(id);

  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const month = typeof rawMonth === "string" && /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : currentMonth;
  const allTime = rawMonth === "all";
  const filters = allTime ? {} : monthBounds(month);

  const [rows, members] = await Promise.all([
    listSharedTransactions(id, filters),
    listMembers(id),
  ]);
  const summary = await summarizeHousehold(id, rows, household.baseCurrency, getRate);
  const nameById = new Map(members.map((m) => [m.id, m.displayName]));
  const me = summary.balances.find((b) => b.userId === userId);

  const monthLabel = allTime
    ? "All time"
    : new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
        new Date(`${month}-01T00:00:00Z`),
      );

  const feed = rows.map((r, i) => ({
    row: r,
    heading: i === 0 || rows[i - 1].date !== r.date ? formatDateHeading(r.date) : null,
  }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title={household.name}
        description={`${members.length} member${members.length === 1 ? "" : "s"} · ${household.baseCurrency}`}
        actions={
          <ButtonLink href={`/households/${id}/settings`} variant="secondary" size="sm">
            Settings
          </ButtonLink>
        }
      />

      <div className="flex items-center gap-2">
        <Link
          href={`/households/${id}?month=${shiftMonth(allTime ? currentMonth : month, -1)}`}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-muted"
          aria-label="Previous month"
        >
          ‹
        </Link>
        <span className="min-w-36 text-center text-sm font-medium">{monthLabel}</span>
        <Link
          href={`/households/${id}?month=${shiftMonth(allTime ? currentMonth : month, 1)}`}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-muted"
          aria-label="Next month"
        >
          ›
        </Link>
        <Link
          href={`/households/${id}?month=${allTime ? currentMonth : "all"}`}
          className="ml-auto text-xs font-medium text-muted hover:text-foreground"
        >
          {allTime ? "This month" : "All time"}
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="flex flex-col gap-1">
          <CardTitle>Shared spending</CardTitle>
          <span className="tnum text-2xl font-semibold">
            {formatCents(summary.totalCents, summary.baseCurrency)}
          </span>
          {summary.pendingRateCount > 0 && (
            <span className="text-xs text-warning">
              {summary.pendingRateCount} row{summary.pendingRateCount === 1 ? "" : "s"} awaiting FX
              rate
            </span>
          )}
        </Card>
        <Card className="flex flex-col gap-1">
          <CardTitle>Your share</CardTitle>
          <span className="tnum text-2xl font-semibold">
            {formatCents(me?.shareCents ?? 0, summary.baseCurrency)}
          </span>
          <span className="text-xs text-muted">
            you paid {formatCents(me?.paidCents ?? 0, summary.baseCurrency)}
          </span>
        </Card>
        <Card className="flex flex-col gap-2">
          <CardTitle>Balances</CardTitle>
          <ul className="flex flex-col gap-1 text-sm">
            {summary.balances.map((b) => (
              <li key={b.userId} className="flex items-center justify-between gap-2">
                <span className="truncate">{b.userId === userId ? "You" : b.displayName}</span>
                <span
                  className={`tnum font-semibold ${
                    b.netCents > 0 ? "text-income" : b.netCents < 0 ? "text-expense" : "text-muted"
                  }`}
                >
                  {b.netCents > 0 ? "+" : ""}
                  {formatCents(b.netCents, summary.baseCurrency)}
                </span>
              </li>
            ))}
          </ul>
          <span className="text-xs text-muted">positive = is owed, negative = owes</span>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="flex flex-col gap-3">
          <CardTitle>By category</CardTitle>
          {summary.byCategory.length === 0 ? (
            <p className="text-sm text-muted">Nothing shared in this period.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {summary.byCategory.map((c) => {
                const pct = summary.totalCents > 0 ? Math.max(0, (c.cents / summary.totalCents) * 100) : 0;
                return (
                  <li key={c.name} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="w-5 text-center">{c.icon ?? "•"}</span>
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="tnum shrink-0 font-medium">
                        {formatCents(c.cents, summary.baseCurrency)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <CardTitle>Shared transactions</CardTitle>
          {rows.length === 0 ? (
            <EmptyState
              title="No shared transactions"
              description="Share one from your Transactions list — it stays in your ledger and shows up here for everyone."
              action={
                <ButtonLink href="/transactions" size="sm" variant="secondary">
                  Go to transactions
                </ButtonLink>
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {feed.map(({ row: r, heading }) => {
                const mine = r.paidByUserId === userId;
                const mySplit = r.splits.find((s) => s.userId === userId)?.shareCents ?? 0;
                const content = (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-base">
                        {r.categoryIcon ?? (r.type === "income" ? "↑" : "↓")}
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">
                          {r.payee ?? r.categoryName ?? (r.type === "income" ? "Income" : "Expense")}
                        </span>
                        <span className="truncate text-xs text-muted">
                          {r.categoryName ?? "Uncategorized"} · paid by {mine ? "you" : nameById.get(r.paidByUserId) ?? "member"}
                          {" · "}
                          {r.splits
                            .map((s) => `${s.userId === userId ? "you" : nameById.get(s.userId) ?? "?"} ${formatCents(s.shareCents, r.currency)}`)
                            .join(", ")}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end">
                      <span className={`tnum text-sm font-semibold ${r.type === "income" ? "text-income" : "text-expense"}`}>
                        {r.type === "income" ? "+" : "-"}
                        {formatCents(Math.abs(toCents(r.amount, r.currency)), r.currency)}
                      </span>
                      <span className="tnum text-xs text-muted">your share {formatCents(mySplit, r.currency)}</span>
                    </div>
                  </div>
                );
                return (
                  <li key={r.shareId} className="flex flex-col gap-2">
                    {heading && <span className="pt-1 text-xs font-medium text-faint">{heading}</span>}
                    {mine ? (
                      <Link href={`/transactions/${r.transactionId}/edit`} className="block">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
