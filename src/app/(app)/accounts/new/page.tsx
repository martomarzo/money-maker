import { requireMembership } from "@/lib/session";
import { AccountForm } from "@/components/account-form";
import { ButtonLink, PageHeader } from "@/components/ui";

export default async function NewAccountPage() {
  await requireMembership();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ButtonLink href="/accounts" variant="ghost" size="sm" className="self-start">
        ← Accounts
      </ButtonLink>
      <PageHeader title="New account" />
      <div className="mx-auto w-full max-w-lg">
        <AccountForm />
      </div>
    </div>
  );
}
