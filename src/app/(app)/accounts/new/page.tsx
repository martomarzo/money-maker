import Link from "next/link";
import { requireMembership } from "@/lib/session";
import { AccountForm } from "@/components/account-form";

export default async function NewAccountPage() {
  await requireMembership();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href="/accounts"
        className="self-start text-sm text-black/60 hover:underline dark:text-white/60"
      >
        ← Accounts
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">New account</h1>
      <div className="max-w-sm">
        <AccountForm />
      </div>
    </div>
  );
}
