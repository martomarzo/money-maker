import Link from "next/link";
import { and, eq, isNull, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireMembership } from "@/lib/session";
import { AccountForm } from "@/components/account-form";

export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId, householdId } = await requireMembership();
  const { id } = await params;

  const account = await db.query.accounts.findFirst({
    where: and(
      eq(accounts.id, id),
      eq(accounts.householdId, householdId),
      or(isNull(accounts.ownerUserId), eq(accounts.ownerUserId, userId)),
    ),
  });
  if (!account) notFound();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href="/accounts"
        className="self-start text-sm text-black/60 hover:underline dark:text-white/60"
      >
        ← Accounts
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">Edit account</h1>
      <div className="max-w-sm">
        <AccountForm
          account={{
            id: account.id,
            name: account.name,
            type: account.type,
            currency: account.currency.trim(),
            country: account.country,
            initialBalance: account.initialBalance,
            ownerUserId: account.ownerUserId,
            archived: account.archived,
          }}
        />
      </div>
    </div>
  );
}
