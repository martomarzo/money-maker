"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  createTransaction,
  createTransfer,
  deleteTransaction,
  updateTransaction,
} from "@/lib/actions/transactions";
import { Button, ErrorText, inputClass, labelClass } from "@/components/ui";

interface AccountOption {
  id: string;
  name: string;
  currency: string;
}

interface CategoryOption {
  id: string;
  parentId: string | null;
  name: string;
  icon: string | null;
}

interface EditableTransaction {
  id: string;
  type: "expense" | "income";
  amount: string;
  date: string;
  categoryId: string | null;
  payee: string | null;
  notes: string | null;
  visibility: "shared" | "personal";
  accountId: string;
  accountName: string;
  currency: string;
}

interface TransactionFormProps {
  accounts: AccountOption[];
  categories: CategoryOption[];
  transaction?: EditableTransaction;
  defaultMode?: Mode;
}

type Mode = "expense" | "income" | "transfer";

const amountInputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-3 text-3xl font-semibold tabular-nums text-foreground outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-ring disabled:opacity-60";

export function TransactionForm({
  accounts,
  categories,
  transaction,
  defaultMode,
}: TransactionFormProps) {
  const router = useRouter();
  const isEdit = Boolean(transaction);
  const [mode, setMode] = useState<Mode>(transaction?.type ?? defaultMode ?? "expense");

  const [entryState, entryAction, entryPending] = useActionState(
    isEdit ? updateTransaction : createTransaction,
    null,
  );
  const [transferState, transferAction, transferPending] = useActionState(
    createTransfer,
    null,
  );
  const [isDeleting, startDelete] = useTransition();

  // Default the date input to "today" without baking a server-computed date
  // into the SSR'd HTML (server and client clocks/timezones can disagree).
  // Set it imperatively post-mount instead of via state, so an empty
  // uncontrolled input never gets left blank on a fresh client.
  const entryDateRef = useRef<HTMLInputElement>(null);
  const transferDateRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (entryDateRef.current && !entryDateRef.current.value) {
      entryDateRef.current.value = today;
    }
    if (transferDateRef.current && !transferDateRef.current.value) {
      transferDateRef.current.value = today;
    }
  }, []);

  useEffect(() => {
    if (entryState?.ok) {
      router.push("/transactions");
      router.refresh();
    }
  }, [entryState, router]);

  useEffect(() => {
    if (transferState?.ok) {
      router.push("/transactions");
      router.refresh();
    }
  }, [transferState, router]);

  const parents = categories.filter((c) => c.parentId === null);
  const childrenByParent = new Map<string, CategoryOption[]>();
  for (const c of categories) {
    if (c.parentId) {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }
  }

  const [fromAccountId, setFromAccountId] = useState(accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? accounts[0]?.id ?? "");
  const fromCurrency = accounts.find((a) => a.id === fromAccountId)?.currency;
  const toCurrency = accounts.find((a) => a.id === toAccountId)?.currency;
  const showToAmount = Boolean(fromCurrency && toCurrency && fromCurrency !== toCurrency);

  function handleDelete() {
    if (!transaction) return;
    if (!confirm("Delete this transaction?")) return;
    startDelete(async () => {
      await deleteTransaction(transaction.id);
      router.push("/transactions");
      router.refresh();
    });
  }

  const modeOptions: Mode[] = isEdit ? ["expense", "income"] : ["expense", "income", "transfer"];

  return (
    <div className="flex flex-col gap-6">
      {modeOptions.length > 1 && (
        <div className="flex rounded-lg border border-border bg-surface-muted p-1 text-sm">
          {modeOptions.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium capitalize transition-colors ${
                mode === m
                  ? "bg-accent text-on-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {mode === "transfer" ? (
        <form action={transferAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="amount" className={labelClass}>
              Amount
            </label>
            <input
              id="amount"
              name="amount"
              type="text"
              inputMode="decimal"
              autoFocus
              required
              className={amountInputClass}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="fromAccountId" className={labelClass}>
              From account
            </label>
            <select
              id="fromAccountId"
              name="fromAccountId"
              required
              value={fromAccountId}
              onChange={(e) => setFromAccountId(e.target.value)}
              className={inputClass}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="toAccountId" className={labelClass}>
              To account
            </label>
            <select
              id="toAccountId"
              name="toAccountId"
              required
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
              className={inputClass}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>

          {showToAmount && (
            <div className="flex flex-col gap-1">
              <label htmlFor="toAmount" className={labelClass}>
                Received amount
              </label>
              <input
                id="toAmount"
                name="toAmount"
                type="text"
                inputMode="decimal"
                required
                className={`${inputClass} tnum`}
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="date" className={labelClass}>
              Date
            </label>
            <input
              ref={transferDateRef}
              id="date"
              name="date"
              type="date"
              required
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="notes" className={labelClass}>
              Notes
            </label>
            <textarea id="notes" name="notes" rows={2} className={inputClass} />
          </div>

          {transferState && !transferState.ok && <ErrorText>{transferState.error}</ErrorText>}

          <Button type="submit" disabled={transferPending} className="w-full sm:w-auto">
            {transferPending ? "Saving..." : "Save transfer"}
          </Button>
        </form>
      ) : (
        <form action={entryAction} className="flex flex-col gap-4">
          {isEdit && <input type="hidden" name="id" value={transaction!.id} />}
          <input type="hidden" name="type" value={mode} />

          <div className="flex flex-col gap-1">
            <label htmlFor="amount" className={labelClass}>
              Amount
            </label>
            <input
              id="amount"
              name="amount"
              type="text"
              inputMode="decimal"
              autoFocus
              required
              defaultValue={transaction?.amount}
              className={amountInputClass}
            />
          </div>

          {isEdit ? (
            <div className="flex flex-col gap-1">
              <span className={labelClass}>Account</span>
              <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground">
                {transaction!.accountName} ({transaction!.currency})
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="accountId" className={labelClass}>
                Account
              </label>
              <select
                id="accountId"
                name="accountId"
                required
                defaultValue={accounts[0]?.id}
                className={inputClass}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="date" className={labelClass}>
              Date
            </label>
            <input
              ref={entryDateRef}
              id="date"
              name="date"
              type="date"
              required
              defaultValue={transaction?.date}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="categoryId" className={labelClass}>
              Category
            </label>
            <select
              id="categoryId"
              name="categoryId"
              defaultValue={transaction?.categoryId ?? ""}
              className={inputClass}
            >
              <option value="">Uncategorized</option>
              {parents.map((p) => {
                const children = childrenByParent.get(p.id) ?? [];
                const label = `${p.icon ? `${p.icon} ` : ""}${p.name}`;
                if (children.length === 0) {
                  return (
                    <option key={p.id} value={p.id}>
                      {label}
                    </option>
                  );
                }
                return (
                  <optgroup key={p.id} label={label}>
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon ? `${c.icon} ` : ""}
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="payee" className={labelClass}>
              Payee
            </label>
            <input
              id="payee"
              name="payee"
              type="text"
              defaultValue={transaction?.payee ?? ""}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="notes" className={labelClass}>
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={transaction?.notes ?? ""}
              className={inputClass}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              name="visibility"
              value="personal"
              defaultChecked={transaction?.visibility === "personal"}
              className="h-4 w-4 rounded border-border text-accent focus:ring-2 focus:ring-ring"
            />
            Personal — hide from partner
          </label>

          {entryState && !entryState.ok && <ErrorText>{entryState.error}</ErrorText>}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" disabled={entryPending} className="w-full sm:flex-1">
              {entryPending ? "Saving..." : isEdit ? "Save changes" : "Save"}
            </Button>
            {isEdit && (
              <Button
                type="button"
                variant="danger"
                onClick={handleDelete}
                disabled={isDeleting}
                className="w-full sm:w-auto"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
