import { eq } from "drizzle-orm";
import { db } from "@/db";
import { households, memberships, users } from "@/db/schema";
import { requireMembership } from "@/lib/session";
import { listAccountsWithBalances, listTransactions } from "@/lib/queries";
import { formatCents } from "@/lib/domain/money";
import { InvitePartner } from "@/components/invite-partner";
import { TransactionRowItem } from "@/components/transaction-row";
import { Badge, ButtonLink, Card, CardTitle, EmptyState } from "@/components/ui";

export default async function DashboardPage() {
  const { userId, householdId } = await requireMembership();

  const [household, members, accounts, recent] = await Promise.all([
    db.query.households.findFirst({ where: eq(households.id, householdId) }),
    db
      .select({ userId: users.id, displayName: users.displayName, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.householdId, householdId)),
    listAccountsWithBalances(householdId, userId),
    listTransactions(householdId, userId, {}, 8),
  ]);

  const activeAccounts = accounts.filter((a) => !a.archived);
  const showCreator = members.length > 1;

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Hero: primary action */}
      <section className="flex flex-col gap-4 rounded-2xl bg-accent px-5 py-6 text-on-accent">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wider opacity-80">
            {household?.name ?? "Household"} · {household?.baseCurrency}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            What did you spend?
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink
            href="/transactions/new?type=expense"
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
                    {a.ownerUserId && <Badge>personal</Badge>}
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
                <ButtonLink href="/transactions/new?type=expense" size="sm">
                  Add expense
                </ButtonLink>
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {recent.map((row) => (
                <li key={row.transaction.id}>
                  <TransactionRowItem row={row} showCreator={showCreator} showDate />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-4">
        <CardTitle>Household</CardTitle>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between text-sm">
              <span>{member.displayName}</span>
              <Badge className="capitalize">{member.role}</Badge>
            </li>
          ))}
        </ul>
        {members.length < 2 && (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-sm text-muted">Invite your partner to share this household.</p>
            <InvitePartner />
          </div>
        )}
      </Card>
    </div>
  );
}
