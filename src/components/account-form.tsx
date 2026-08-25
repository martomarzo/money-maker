"use client";

import { useEffect, useState, useTransition } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { accounts } from "@/db/schema";
import { createAccount, updateAccount, setAccountArchived } from "@/lib/actions/accounts";
import { Button, ErrorText, inputClass, labelClass, selectClass } from "@/components/ui";

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
          <label htmlFor="name" className={labelClass}>
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
          <label htmlFor="type" className={labelClass}>
            Type
          </label>
          <select
            id="type"
            name="type"
            defaultValue={account?.type ?? "checking"}
            className={selectClass}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelClass}>Currency</label>
          {account ? (
            <p className={`${inputClass} text-muted`}>{account.currency}</p>
          ) : (
            <select id="currency" name="currency" defaultValue="EUR" className={selectClass}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="country" className={labelClass}>
            Country <span className="text-faint">(optional)</span>
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
          <label htmlFor="initialBalance" className={labelClass}>
            Initial balance
          </label>
          <input
            id="initialBalance"
            name="initialBalance"
            type="text"
            inputMode="decimal"
            defaultValue={account?.initialBalance ?? "0"}
            className={`${inputClass} tnum`}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="personal"
            defaultChecked={Boolean(account?.ownerUserId)}
            className="h-4 w-4 rounded border-border"
          />
          Personal account — only visible to me
        </label>

        {state && !state.ok && <ErrorText>{state.error}</ErrorText>}

        <Button type="submit" disabled={pending} className="mt-2">
          {pending ? "Saving..." : isEdit ? "Save changes" : "Create account"}
        </Button>
      </form>

      {account && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {archiveError && <ErrorText>{archiveError}</ErrorText>}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleArchiveToggle}
            disabled={isArchivePending}
            className="self-start"
          >
            {isArchivePending
              ? "Saving..."
              : account.archived
                ? "Unarchive account"
                : "Archive account"}
          </Button>
        </div>
      )}
    </div>
  );
}
