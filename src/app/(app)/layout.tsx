import { signOut } from "@/auth";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { displayName } = await requireUser();

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
    <AppShell householdName={displayName} signOut={signOutForm}>
      {children}
    </AppShell>
  );
}
