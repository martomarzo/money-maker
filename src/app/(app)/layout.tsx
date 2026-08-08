import { eq } from "drizzle-orm";
import { signOut } from "@/auth";
import { db } from "@/db";
import { households } from "@/db/schema";
import { requireMembership } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { householdId } = await requireMembership();

  const household = await db.query.households.findFirst({
    where: eq(households.id, householdId),
  });

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/15">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold tracking-tight">Money Maker</span>
          {household && (
            <span className="text-sm text-black/60 dark:text-white/60">
              {household.name}
            </span>
          )}
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="rounded-md border border-black/10 px-3 py-1.5 text-sm font-medium dark:border-white/15"
          >
            Sign out
          </button>
        </form>
      </header>
      <main className="flex flex-1 flex-col px-4 py-6">{children}</main>
    </div>
  );
}
