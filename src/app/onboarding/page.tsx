import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import { requireUserId } from "@/lib/session";
import { CreateHouseholdForm } from "@/components/create-household-form";
import { JoinHouseholdForm } from "@/components/join-household-form";

export default async function OnboardingPage() {
  const userId = await requireUserId();

  const existingMembership = await db.query.memberships.findFirst({
    where: eq(memberships.userId, userId),
  });
  if (existingMembership) redirect("/");

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-10">
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          Money Maker
        </h1>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Create a household</h2>
          <CreateHouseholdForm />
        </section>

        <div className="flex items-center gap-3 text-xs uppercase text-black/40 dark:text-white/40">
          <span className="h-px flex-1 bg-black/10 dark:bg-white/15" />
          or
          <span className="h-px flex-1 bg-black/10 dark:bg-white/15" />
        </div>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Join with an invite code</h2>
          <JoinHouseholdForm />
        </section>
      </div>
    </div>
  );
}
