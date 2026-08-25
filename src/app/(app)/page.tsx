import { requireUser } from "@/lib/session";
import { listAccountsWithBalances, listTransactions } from "@/lib/queries";
import { formatCents } from "@/lib/domain/money";
import { TransactionRowItem } from "@/components/transaction-row";
import { ButtonLink, Card, CardTitle, EmptyState } from "@/components/ui";

export default async function DashboardPage() {
  const { userId, displayName, baseCurrency } = await requireUser();

  const [accounts, recent] = await Promise.all([
    listAccountsWithBalances(userId),
    listTransactions(userId, {}, 8),
  ]);

  const activeAccounts = accounts.filter((a) => !a.archived);

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

      <div className="grid gap-6 md:grid-cols-[1fr_minmax(0,1.3fr)]">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <CardTitle>Accounts</CardTitle>
            <ButtonLink href="/accounts" variant="ghost" size="sm">
              Manage
            </ButtonLink>
          </div>
          {activeAccounts.length === 0 ? (
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
            <ul className="flex flex-col divide-y divide-border">
              {activeAccounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{a.name}</span>
                  </span>
                  <span className={`tnum shrink-0 font-semibold ${a.balanceCents < 0 ? "text-expense" : ""}`}>
                    {formatCents(a.balanceCents, a.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

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
