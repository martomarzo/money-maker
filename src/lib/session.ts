import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { households, memberships, users } from "@/db/schema";

/** Session user id, or redirect to /login. Use in (app) pages/layouts and actions. */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

/** The signed-in user with the personal-ledger settings pages/actions need. */
export async function requireUser() {
  const userId = await requireUserId();
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, displayName: true, baseCurrency: true },
  });
  if (!user) redirect("/login");
  return { userId, displayName: user.displayName, baseCurrency: user.baseCurrency.trim() };
}

/** Membership in a specific household, or 404-style redirect to /households. */
export async function requireHouseholdMember(householdId: string) {
  const userId = await requireUserId();
  const [row] = await db
    .select({ role: memberships.role, household: households })
    .from(memberships)
    .innerJoin(households, eq(households.id, memberships.householdId))
    .where(and(eq(memberships.userId, userId), eq(memberships.householdId, householdId)))
    .limit(1);
  if (!row) redirect("/households");
  return {
    userId,
    role: row.role,
    household: { ...row.household, baseCurrency: row.household.baseCurrency.trim() },
  };
}
