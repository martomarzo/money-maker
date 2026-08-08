import { requireUserId } from "@/lib/session";
import { JoinHouseholdForm } from "@/components/join-household-form";

export default async function JoinInvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await requireUserId();
  const { code } = await params;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          Join household
        </h1>
        <p className="text-center text-sm text-black/60 dark:text-white/60">
          You&apos;ve been invited to join a household. Confirm below to accept.
        </p>
        <JoinHouseholdForm defaultCode={code} />
      </div>
    </div>
  );
}
