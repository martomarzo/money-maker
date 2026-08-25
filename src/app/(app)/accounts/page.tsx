import { requireMembership } from "@/lib/session";
import { listAccountsWithBalances } from "@/lib/queries";
import { formatCents } from "@/lib/domain/money";
import { setAccountArchived } from "@/lib/actions/accounts";
import { Badge, Button, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import Link from "next/link";

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
      <PageHeader
        title="Accounts"
        actions={<ButtonLink href="/accounts/new">Add account</ButtonLink>}
      />

      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          description="Create one to start tracking balances."
          action={<ButtonLink href="/accounts/new">Add account</ButtonLink>}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {active.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted">Archived</h2>
          <div className="flex flex-col gap-2 opacity-60">
            {archived.map((account) => (
              <Card key={account.id} className="flex items-center justify-between gap-3 p-3">
                <div className="flex flex-col">
                  <span className="font-medium">{account.name}</span>
                  <span className="text-xs text-muted">
                    {TYPE_LABELS[account.type]} · {account.currency}
                  </span>
                </div>
                <form
                  action={async () => {
                    "use server";
                    await setAccountArchived(account.id, false);
                  }}
                >
                  <Button type="submit" variant="secondary" size="sm">
                    Unarchive
                  </Button>
                </form>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AccountCard({ account }: { account: AccountWithBalance }) {
  return (
    <Link href={`/accounts/${account.id}/edit`} className="block">
      <Card className="flex items-center justify-between gap-3 transition-colors hover:border-border-strong">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{account.name}</span>
            <Badge>{account.ownerUserId ? "Personal" : "Joint"}</Badge>
          </div>
          <span className="text-xs text-muted">
            {TYPE_LABELS[account.type]} · {account.currency}
            {account.country ? ` · ${account.country}` : ""}
          </span>
        </div>
        <span
          className={`tnum font-medium ${account.balanceCents < 0 ? "text-expense" : ""}`}
        >
          {formatCents(account.balanceCents, account.currency)}
        </span>
      </Card>
    </Link>
  );
}
