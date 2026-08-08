import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { households } from "@/db/schema";
import { requireMembership } from "@/lib/session";
import {
  listCategories,
  listMembers,
  listTransactions,
  listVisibleAccounts,
  summarizeTransactions,
} from "@/lib/queries";
import { formatCents, toCents } from "@/lib/domain/money";
import { TransactionFilters } from "@/components/transaction-filters";

type TransactionType = "expense" | "income" | "transfer";
type TransactionRow = Awaited<ReturnType<typeof listTransactions>>[number];

function isTransactionType(value: string | undefined): value is TransactionType {
  return value === "expense" || value === "income" || value === "transfer";
}

function typeLabel(type: TransactionType): string {
  if (type === "income") return "Income";
  if (type === "transfer") return "Transfer";
  return "Expense";
}

function typeMarker(type: TransactionType): string {
  if (type === "income") return "↑";
  if (type === "transfer") return "⇄";
  return "↓";
}

function formatSignedAmount(type: TransactionType, amount: string, currency: string): string {
  const cents = toCents(amount, currency);
  if (type === "expense") return `-${formatCents(cents, currency)}`;
  if (type === "income") return `+${formatCents(cents, currency)}`;
  return formatCents(cents, currency);
}

function formatDateHeading(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function TransactionRowItem({
  row,
  showCreator,
}: {
  row: TransactionRow;
  showCreator: boolean;
}) {
  const { transaction: t, accountName, categoryName, categoryIcon, createdByName } = row;
  const isTransfer = t.type === "transfer";
  const label = t.payee ?? categoryName ?? typeLabel(t.type);
  const icon = categoryIcon ?? typeMarker(t.type);
  const amountColor =
    t.type === "expense"
      ? "text-red-600 dark:text-red-400"
      : t.type === "income"
        ? "text-green-600 dark:text-green-400"
        : "text-black/70 dark:text-white/70";

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-sm dark:bg-white/10">
          {icon}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2 truncate text-sm font-medium">
            {label}
            {t.visibility === "personal" && (
              <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
                personal
              </span>
            )}
          </span>
          <span className="truncate text-xs text-black/50 dark:text-white/50">
            {accountName}
            {showCreator && ` · ${createdByName}`}
          </span>
        </div>
      </div>
      <span className={`shrink-0 text-sm font-medium ${amountColor}`}>
        {formatSignedAmount(t.type, t.amount, t.currency)}
      </span>
    </>
  );

  const className =
    "flex items-center justify-between gap-3 rounded-lg border border-black/10 p-3 dark:border-white/15";

  if (isTransfer) {
    return <div className={className}>{content}</div>;
  }

  return (
    <Link
      href={`/transactions/${t.id}/edit`}
      className={`${className} hover:border-black/20 dark:hover:border-white/25`}
    >
      {content}
    </Link>
  );
}

function SummaryCard({ summary }: { summary: ReturnType<typeof summarizeTransactions> }) {
  const { byCurrency, baseCurrency, baseExpenseCents, baseIncomeCents, pendingRateCount } =
    summary;
  if (byCurrency.size === 0) return null;

  const showBaseLine = baseExpenseCents !== 0 || baseIncomeCents !== 0;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
      <h2 className="text-sm font-medium text-black/60 dark:text-white/60">Summary</h2>
      <div className="flex flex-col gap-1 text-sm">
        {[...byCurrency.entries()].map(([currency, totals]) => (
          <div key={currency} className="flex items-center justify-between">
            <span className="text-black/60 dark:text-white/60">{currency}</span>
            <span className="flex gap-3">
              <span className="text-red-600 dark:text-red-400">
                -{formatCents(totals.expenseCents, currency)}
              </span>
              <span className="text-green-600 dark:text-green-400">
                +{formatCents(totals.incomeCents, currency)}
              </span>
            </span>
          </div>
        ))}
      </div>
      {showBaseLine && (
        <p className="text-sm text-black/70 dark:text-white/70">
          &asymp; {formatCents(baseExpenseCents, baseCurrency)} {baseCurrency} spent /{" "}
          {formatCents(baseIncomeCents, baseCurrency)} {baseCurrency} in
        </p>
      )}
      {pendingRateCount > 0 && (
        <p className="text-xs text-black/50 dark:text-white/50">
          {pendingRateCount} awaiting FX rate
        </p>
      )}
    </section>
  );
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { userId, householdId } = await requireMembership();
  const params = await searchParams;

  function getParam(key: string): string | undefined {
    const value = params[key];
    return typeof value === "string" && value ? value : undefined;
  }

  const accountParam = getParam("account");
  const categoryParam = getParam("category");
  const personParam = getParam("person");
  const typeParam = getParam("type");
  const fromParam = getParam("from");
  const toParam = getParam("to");

  const [household, allAccounts, categories, members, rows] = await Promise.all([
    db.query.households.findFirst({ where: eq(households.id, householdId) }),
    listVisibleAccounts(householdId, userId),
    listCategories(householdId),
    listMembers(householdId),
    listTransactions(householdId, userId, {
      accountId: accountParam,
      categoryId: categoryParam,
      createdByUserId: personParam,
      type: isTransactionType(typeParam) ? typeParam : undefined,
      from: fromParam,
      to: toParam,
    }),
  ]);

  const baseCurrency = (household?.baseCurrency ?? "EUR").trim();
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

  const showCreator = members.length >= 2;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Transactions</h1>
        <Link
          href="/transactions/new"
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          Add
        </Link>
      </div>

      <TransactionFilters
        accounts={formAccounts}
        categories={categories}
        members={members}
        account={accountParam}
        category={categoryParam}
        person={personParam}
        type={typeParam}
        from={fromParam}
        to={toParam}
      />

      <SummaryCard summary={summary} />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/15 p-8 text-center text-sm text-black/50 dark:border-white/20 dark:text-white/50">
          No transactions yet.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {[...groups.entries()].map(([date, dateRows]) => (
            <div key={date} className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
                {formatDateHeading(date)}
              </h2>
              <div className="flex flex-col gap-2">
                {dateRows.map((row) => (
                  <TransactionRowItem
                    key={row.transaction.id}
                    row={row}
                    showCreator={showCreator}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
