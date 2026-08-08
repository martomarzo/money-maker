import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { memberships } from "@/db/schema";

/** Session user id, or redirect to /login. Use in (app) pages/layouts and actions. */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

/** Membership for the user, or redirect to /onboarding if they have none. */
export async function requireMembership() {
  const userId = await requireUserId();
  const membership = await db.query.memberships.findFirst({
    where: eq(memberships.userId, userId),
  });
  if (!membership) redirect("/onboarding");
  return { userId, householdId: membership.householdId, role: membership.role };
}
