"use client";

import { useEffect, useState, useTransition } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { accounts } from "@/db/schema";
import { createAccount, updateAccount, setAccountArchived } from "@/lib/actions/accounts";

type Account = typeof accounts.$inferSelect;

export type AccountFormAccount = Pick<
  Account,
  "id" | "name" | "type" | "currency" | "country" | "initialBalance" | "ownerUserId" | "archived"
>;

const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "cash", label: "Cash" },
  { value: "credit_card", label: "Credit card" },
] as const;

const CURRENCIES = ["EUR", "USD", "ARS", "PYG"] as const;

const inputClass =
  "rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/30";

export function AccountForm({ account }: { account?: AccountFormAccount }) {
  const router = useRouter();
  const isEdit = Boolean(account);
  const [state, formAction, pending] = useActionState(
    isEdit ? updateAccount : createAccount,
    null,
  );
  const [isArchivePending, startArchiveTransition] = useTransition();
  const [archiveError, setArchiveError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      router.push("/accounts");
      router.refresh();
    }
  }, [state, router]);

  function handleArchiveToggle() {
    if (!account) return;
    setArchiveError(null);
    startArchiveTransition(async () => {
      const result = await setAccountArchived(account.id, !account.archived);
      if (!result.ok) {
        setArchiveError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        {account && <input type="hidden" name="id" value={account.id} />}
        {account && <input type="hidden" name="currency" value={account.currency} />}

        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={account?.name}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="type" className="text-sm font-medium">
            Type
          </label>
          <select
            id="type"
            name="type"
            defaultValue={account?.type ?? "checking"}
            className={inputClass}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Currency</label>
          {account ? (
            <p className={`${inputClass} text-black/70 dark:text-white/70`}>
              {account.currency}
            </p>
          ) : (
            <select id="currency" name="currency" defaultValue="EUR" className={inputClass}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="country" className="text-sm font-medium">
            Country{" "}
            <span className="text-black/40 dark:text-white/40">(optional)</span>
          </label>
          <input
            id="country"
            name="country"
            type="text"
            maxLength={2}
            placeholder="AR"
            defaultValue={account?.country ?? ""}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="initialBalance" className="text-sm font-medium">
            Initial balance
          </label>
          <input
            id="initialBalance"
            name="initialBalance"
            type="text"
            inputMode="decimal"
            defaultValue={account?.initialBalance ?? "0"}
            className={inputClass}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="personal"
            defaultChecked={Boolean(account?.ownerUserId)}
            className="h-4 w-4 rounded border-black/20 dark:border-white/25"
          />
          Personal account — only visible to me
        </label>

        {state && !state.ok && (
          <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
        >
          {pending ? "Saving..." : isEdit ? "Save changes" : "Create account"}
        </button>
      </form>

      {account && (
        <div className="flex flex-col gap-2 border-t border-black/10 pt-4 dark:border-white/15">
          {archiveError && (
            <p className="text-sm text-red-600 dark:text-red-400">{archiveError}</p>
          )}
          <button
            type="button"
            onClick={handleArchiveToggle}
            disabled={isArchivePending}
            className="self-start rounded-md border border-black/10 px-3 py-1.5 text-xs font-medium disabled:opacity-60 dark:border-white/15"
          >
            {isArchivePending
              ? "Saving..."
              : account.archived
                ? "Unarchive account"
                : "Archive account"}
          </button>
        </div>
      )}
    </div>
  );
}
