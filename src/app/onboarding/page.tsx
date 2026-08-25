import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import { requireUserId } from "@/lib/session";
import { CreateHouseholdForm } from "@/components/create-household-form";
import { JoinHouseholdForm } from "@/components/join-household-form";
import { Logo } from "@/components/app-shell";
import { Card, CardTitle } from "@/components/ui";

export default async function OnboardingPage() {
  const userId = await requireUserId();

  const existingMembership = await db.query.memberships.findFirst({
    where: eq(memberships.userId, userId),
  });
  if (existingMembership) redirect("/");

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <Logo className="h-10 w-10" />
          <span className="text-xl font-semibold tracking-tight">Money Maker</span>
          <span className="text-sm text-muted">Household finance</span>
        </div>

        <Card className="flex flex-col gap-4">
          <CardTitle>Create a household</CardTitle>
          <CreateHouseholdForm />
        </Card>

        <div className="flex items-center gap-3 text-xs uppercase text-faint">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <Card className="flex flex-col gap-4">
          <CardTitle>Join with an invite code</CardTitle>
          <JoinHouseholdForm />
        </Card>
      </div>
    </div>
  );
}
