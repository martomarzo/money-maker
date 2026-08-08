import { eq } from "drizzle-orm";
import { db } from "@/db";
import { households, memberships, users } from "@/db/schema";
import { requireMembership } from "@/lib/session";
import { InvitePartner } from "@/components/invite-partner";

export default async function DashboardPage() {
  const { householdId } = await requireMembership();

  const [household, members] = await Promise.all([
    db.query.households.findFirst({ where: eq(households.id, householdId) }),
    db
      .select({
        userId: users.id,
        displayName: users.displayName,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.householdId, householdId)),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <section className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {household?.name ?? "Household"}
          </h1>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
            {household?.baseCurrency}
          </span>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <h2 className="text-sm font-medium text-black/60 dark:text-white/60">
          Members
        </h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between text-sm">
              <span>{member.displayName}</span>
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs capitalize dark:bg-white/10">
                {member.role}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <h2 className="text-sm font-medium text-black/60 dark:text-white/60">
          Invite partner
        </h2>
        <InvitePartner />
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-dashed border-black/15 p-4 text-sm text-black/50 dark:border-white/20 dark:text-white/50">
        Coming soon: accounts &amp; transactions
      </section>
    </div>
  );
}
