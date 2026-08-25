import { eq } from "drizzle-orm";
import { signOut } from "@/auth";
import { db } from "@/db";
import { households } from "@/db/schema";
import { requireMembership } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { householdId } = await requireMembership();

  const household = await db.query.households.findFirst({
    where: eq(households.id, householdId),
  });

  const signOutForm = (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );

  return (
    <AppShell householdName={household?.name} signOut={signOutForm}>
      {children}
    </AppShell>
  );
}
