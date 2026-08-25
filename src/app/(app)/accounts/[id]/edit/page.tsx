import { and, eq, isNull, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireMembership } from "@/lib/session";
import { AccountForm } from "@/components/account-form";
import { ButtonLink, PageHeader } from "@/components/ui";

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
      <ButtonLink href="/accounts" variant="ghost" size="sm" className="self-start">
        ← Accounts
      </ButtonLink>
      <PageHeader title="Edit account" />
      <div className="mx-auto w-full max-w-lg">
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
