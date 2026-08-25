import { requireUser } from "@/lib/session";
import { listAccounts, listCategories, listTransactions, summarizeTransactions } from "@/lib/queries";
import { formatCents } from "@/lib/domain/money";
import { TransactionFilters } from "@/components/transaction-filters";
import {
  TransactionRowItem,
  type TransactionRow,
  formatDateHeading,
  isTransactionType,
} from "@/components/transaction-row";
import { ButtonLink, Card, CardTitle, EmptyState, PageHeader } from "@/components/ui";

function SummaryCard({ summary }: { summary: ReturnType<typeof summarizeTransactions> }) {
  const { byCurrency, baseCurrency, baseExpenseCents, baseIncomeCents, pendingRateCount } =
    summary;
  if (byCurrency.size === 0) return null;

  const showBaseLine = baseExpenseCents !== 0 || baseIncomeCents !== 0;

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Summary</CardTitle>
      <div className="flex flex-col gap-1 text-sm">
        {[...byCurrency.entries()].map(([currency, totals]) => (
          <div key={currency} className="flex items-center justify-between">
            <span className="text-muted">{currency}</span>
            <span className="flex gap-3">
              <span className="tnum text-expense">
                -{formatCents(totals.expenseCents, currency)}
              </span>
              <span className="tnum text-income">
                +{formatCents(totals.incomeCents, currency)}
              </span>
            </span>
          </div>
        ))}
      </div>
      {showBaseLine && (
        <p className="tnum text-sm text-muted">
          &asymp; {formatCents(baseExpenseCents, baseCurrency)} {baseCurrency} spent /{" "}
          {formatCents(baseIncomeCents, baseCurrency)} {baseCurrency} in
        </p>
      )}
      {pendingRateCount > 0 && (
        <p className="text-xs text-faint">{pendingRateCount} awaiting FX rate</p>
      )}
    </Card>
  );
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { userId, baseCurrency } = await requireUser();
  const params = await searchParams;

  function getParam(key: string): string | undefined {
    const value = params[key];
    return typeof value === "string" && value ? value : undefined;
  }

  const accountParam = getParam("account");
  const categoryParam = getParam("category");
  const typeParam = getParam("type");
  const sharedParam = getParam("shared");
  const fromParam = getParam("from");
  const toParam = getParam("to");
  const shared = sharedParam === "yes" || sharedParam === "no" ? sharedParam : undefined;

  const [allAccounts, categories, rows] = await Promise.all([
    listAccounts(userId),
    listCategories(userId),
    listTransactions(userId, {
      accountId: accountParam,
      categoryId: categoryParam,
      type: isTransactionType(typeParam) ? typeParam : undefined,
      shared,
      from: fromParam,
      to: toParam,
    }),
  ]);

  const summary = summarizeTransactions(rows, baseCurrency);

  const formAccounts = allAccounts
    .filter((a) => !a.archived)
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency.trim() }));

  const groups = new Map<string, TransactionRow[]>();
  for (const row of rows) {
    const list = groups.get(row.transaction.date) ?? [];
    list.push(row);
    groups.set(row.transaction.date, list);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Transactions"
        actions={
          <ButtonLink href="/transactions/new" size="sm">
            Add
          </ButtonLink>
        }
      />

      <TransactionFilters
        accounts={formAccounts}
        categories={categories}
        account={accountParam}
        category={categoryParam}
        type={typeParam}
        shared={sharedParam}
        from={fromParam}
        to={toParam}
      />

      <SummaryCard summary={summary} />

      {rows.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          description="Add an expense, income or transfer to see it here."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {[...groups.entries()].map(([date, dateRows]) => (
            <div key={date} className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
                {formatDateHeading(date)}
              </h2>
              <div className="flex flex-col gap-2">
                {dateRows.map((row) => (
                  <TransactionRowItem key={row.transaction.id} row={row} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
