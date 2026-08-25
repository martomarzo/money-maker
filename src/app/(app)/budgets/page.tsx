import Link from "next/link";
import { requireUser } from "@/lib/session";
import { budgetsForMonth, currentMonth, isMonth, shiftMonth } from "@/lib/reports";
import { formatCents } from "@/lib/domain/money";
import { BudgetList } from "@/components/budgets/budget-list";
import { CopyLastMonth } from "@/components/budgets/copy-last-month";
import { Card, CardTitle, PageHeader } from "@/components/ui";

export default async function BudgetsPage({ searchParams }: PageProps<"/budgets">) {
  const { userId, baseCurrency } = await requireUser();
  const { month: rawMonth } = await searchParams;
  const month = isMonth(rawMonth) ? rawMonth : currentMonth();

  const rows = await budgetsForMonth(userId, baseCurrency, month);

  const totalBudgetCents = rows.reduce((sum, r) => sum + (r.budgetCents ?? 0), 0);
  const totalSpentCents = rows.reduce(
    (sum, r) => sum + (r.budgetCents !== null ? r.actualCents : 0),
    0,
  );
  const remainingCents = totalBudgetCents - totalSpentCents;

  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Budgets"
        description={`Amounts are in your base currency (${baseCurrency}).`}
        actions={<CopyLastMonth month={month} />}
      />

      <div className="flex items-center gap-2">
        <Link
          href={`/budgets?month=${shiftMonth(month, -1)}`}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-muted"
          aria-label="Previous month"
        >
          ‹
        </Link>
        <span className="min-w-36 text-center text-sm font-medium">{monthLabel}</span>
        <Link
          href={`/budgets?month=${shiftMonth(month, 1)}`}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-muted"
          aria-label="Next month"
        >
          ›
        </Link>
      </div>

      <Card className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Budgeted</CardTitle>
          <span className="tnum text-xl font-semibold">
            {formatCents(totalBudgetCents, baseCurrency)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <CardTitle>Spent</CardTitle>
          <span className="tnum text-xl font-semibold">
            {formatCents(totalSpentCents, baseCurrency)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <CardTitle>Remaining</CardTitle>
          <span
            className={`tnum text-xl font-semibold ${remainingCents < 0 ? "text-danger" : ""}`}
          >
            {formatCents(remainingCents, baseCurrency)}
          </span>
        </div>
      </Card>

      <Card className="flex flex-col gap-1">
        <CardTitle className="px-1">Categories</CardTitle>
        <BudgetList rows={rows} month={month} baseCurrency={baseCurrency} />
      </Card>
    </div>
  );
}
