import Link from "next/link";
import { requireMembership } from "@/lib/session";
import { listAccountsWithBalances } from "@/lib/queries";
import { formatCents } from "@/lib/domain/money";
import { setAccountArchived } from "@/lib/actions/accounts";

type AccountWithBalance = Awaited<ReturnType<typeof listAccountsWithBalances>>[number];

const TYPE_LABELS: Record<AccountWithBalance["type"], string> = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  credit_card: "Credit card",
};

export default async function AccountsPage() {
  const { userId, householdId } = await requireMembership();
  const accounts = await listAccountsWithBalances(householdId, userId);

  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Accounts</h1>
        <Link
          href="/accounts/new"
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          New account
        </Link>
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">
          No accounts yet. Create one to start tracking balances.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {active.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-black/60 dark:text-white/60">
            Archived
          </h2>
          <div className="flex flex-col gap-2 opacity-60">
            {archived.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/15"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{account.name}</span>
                  <span className="text-xs text-black/50 dark:text-white/50">
                    {TYPE_LABELS[account.type]} · {account.currency}
                  </span>
                </div>
                <form
                  action={async () => {
                    "use server";
                    await setAccountArchived(account.id, false);
                  }}
                >
                  <button
                    type="submit"
                    className="rounded-md border border-black/10 px-3 py-1.5 text-xs font-medium dark:border-white/15"
                  >
                    Unarchive
                  </button>
                </form>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AccountCard({ account }: { account: AccountWithBalance }) {
  return (
    <Link
      href={`/accounts/${account.id}/edit`}
      className="flex items-center justify-between gap-3 rounded-lg border border-black/10 p-4 transition hover:border-black/20 dark:border-white/15 dark:hover:border-white/30"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{account.name}</span>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
            {account.ownerUserId ? "Personal" : "Joint"}
          </span>
        </div>
        <span className="text-xs text-black/50 dark:text-white/50">
          {TYPE_LABELS[account.type]} · {account.currency}
          {account.country ? ` · ${account.country}` : ""}
        </span>
      </div>
      <span className="font-medium tabular-nums">
        {formatCents(account.balanceCents, account.currency)}
      </span>
    </Link>
  );
}
