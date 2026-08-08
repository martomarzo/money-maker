"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { commitStatement, type StatementPreview } from "@/lib/actions/import";
import { formatCents } from "@/lib/domain/money";

type AccountType = "checking" | "savings" | "cash" | "credit_card";

interface AccountChoiceExisting {
  mode: "existing";
  accountId: string;
}
interface AccountChoiceNew {
  mode: "new";
  name: string;
  type: AccountType;
}
type AccountChoice = AccountChoiceExisting | AccountChoiceNew;

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "cash", label: "Cash" },
  { value: "credit_card", label: "Credit card" },
];

const inputClass =
  "rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/30";
const badgeClass = "rounded-full px-2 py-0.5 text-xs font-medium";

const MAX_RENDERED_ROWS = 300;
const NEW_ACCOUNT_VALUE = "__new__";

function formatSignedAmount(draft: StatementPreview["drafts"][number]): string {
  const { amountCents, currency, type } = draft;
  if (type === "expense") return `-${formatCents(amountCents, currency)}`;
  if (type === "income") return `+${formatCents(amountCents, currency)}`;
  return formatCents(amountCents, currency);
}

export function ImportPreview({ preview }: { preview: StatementPreview }) {
  const [state, formAction, pending] = useActionState(commitStatement, null);

  const [accountChoices, setAccountChoices] = useState<Record<string, AccountChoice>>(() => {
    const initial: Record<string, AccountChoice> = {};
    for (const proposal of preview.accountProposals) {
      initial[proposal.currency] =
        proposal.kind === "existing" && proposal.accountId
          ? { mode: "existing", accountId: proposal.accountId }
          : {
              mode: "new",
              name: proposal.proposedName ?? `${preview.source} ${proposal.currency}`,
              type: (proposal.proposedType ?? "checking") as AccountType,
            };
    }
    return initial;
  });

  const [excluded, setExcluded] = useState<Set<number>>(
    () => new Set(preview.drafts.filter((d) => d.alreadyImported).map((d) => d.index)),
  );

  const [categorySelections, setCategorySelections] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    for (const d of preview.drafts) initial[d.index] = d.suggestedCategoryId ?? "";
    return initial;
  });

  function toggleIncluded(index: number, alreadyImported: boolean) {
    if (alreadyImported) return;
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const parents = preview.categories.filter((c) => c.parentId === null);
  const childrenByParent = new Map<string, typeof preview.categories>();
  for (const c of preview.categories) {
    if (c.parentId) {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }
  }

  const excludedIndicesJson = useMemo(() => JSON.stringify([...excluded]), [excluded]);
  const categoryOverridesJson = useMemo(
    () =>
      JSON.stringify(
        Object.fromEntries(Object.entries(categorySelections).map(([k, v]) => [k, v || null])),
      ),
    [categorySelections],
  );
  const accountChoicesJson = useMemo(() => JSON.stringify(accountChoices), [accountChoices]);

  const visibleDrafts = preview.drafts.slice(0, MAX_RENDERED_ROWS);
  const hiddenCount = preview.drafts.length - visibleDrafts.length;

  if (state?.ok) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-black/10 p-6 dark:border-white/15">
        <h2 className="text-lg font-semibold">Import complete</h2>
        <ul className="flex flex-col gap-1 text-sm text-black/70 dark:text-white/70">
          <li>{state.importedCount} transactions imported</li>
          <li>{state.skippedDuplicateCount} skipped as duplicates</li>
          <li>{state.skippedFilteredCount} excluded</li>
          <li>{state.transfersLinked} transfer pair(s) linked in this batch</li>
          {state.unlinkedTransfersMatched > 0 && (
            <li>
              {state.unlinkedTransfersMatched} additional transfer pair(s) matched
              household-wide
            </li>
          )}
        </ul>
        <Link
          href="/import"
          className="self-start rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          Back to imports
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="filename" value={preview.filename} />
      <input type="hidden" name="accountChoices" value={accountChoicesJson} />
      <input type="hidden" name="excludedIndices" value={excludedIndicesJson} />
      <input type="hidden" name="categoryOverrides" value={categoryOverridesJson} />

      <div className="flex flex-col gap-1 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{preview.filename}</h1>
            <p className="text-xs text-black/50 dark:text-white/50">
              {preview.source} · {preview.sourceFile}
            </p>
          </div>
          <span className="text-xs text-black/50 dark:text-white/50">
            {preview.dateFrom} – {preview.dateTo}
          </span>
        </div>
        {preview.warnings.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-xs text-amber-700 dark:text-amber-400">
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <h2 className="text-sm font-medium text-black/60 dark:text-white/60">Account mapping</h2>
        {preview.currencies.map((currency) => {
          const choice = accountChoices[currency];
          const options = preview.existingAccountsByCurrency[currency] ?? [];
          return (
            <div key={currency} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-sm font-medium">{currency}</label>
                <select
                  value={choice.mode === "existing" ? choice.accountId : NEW_ACCOUNT_VALUE}
                  onChange={(e) => {
                    const value = e.target.value;
                    setAccountChoices((prev) => {
                      const current = prev[currency];
                      return {
                        ...prev,
                        [currency]:
                          value === NEW_ACCOUNT_VALUE
                            ? {
                                mode: "new",
                                name:
                                  current?.mode === "new"
                                    ? current.name
                                    : `${preview.source} ${currency}`,
                                type: current?.mode === "new" ? current.type : "checking",
                              }
                            : { mode: "existing", accountId: value },
                      };
                    });
                  }}
                  className={inputClass}
                >
                  {options.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                  <option value={NEW_ACCOUNT_VALUE}>Create new…</option>
                </select>
              </div>
              {choice.mode === "new" && (
                <>
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-sm font-medium">Name</label>
                    <input
                      type="text"
                      value={choice.name}
                      onChange={(e) =>
                        setAccountChoices((prev) => ({
                          ...prev,
                          [currency]: { mode: "new", type: choice.type, name: e.target.value },
                        }))
                      }
                      className={inputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium">Type</label>
                    <select
                      value={choice.type}
                      onChange={(e) =>
                        setAccountChoices((prev) => ({
                          ...prev,
                          [currency]: {
                            mode: "new",
                            name: choice.name,
                            type: e.target.value as AccountType,
                          },
                        }))
                      }
                      className={inputClass}
                    >
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <span className={`${badgeClass} bg-red-500/10 text-red-700 dark:text-red-400`}>
          {preview.summary.expenseCount} expense
        </span>
        <span className={`${badgeClass} bg-green-500/10 text-green-700 dark:text-green-400`}>
          {preview.summary.incomeCount} income
        </span>
        <span className={`${badgeClass} bg-black/5 dark:bg-white/10`}>
          {preview.summary.transferCount} transfer
        </span>
        <span className={`${badgeClass} bg-black/5 dark:bg-white/10`}>
          {preview.summary.alreadyImportedCount} already imported
        </span>
        <span className={`${badgeClass} bg-amber-500/10 text-amber-700 dark:text-amber-400`}>
          {preview.summary.inBatchDuplicateCount} in-file duplicates
        </span>
        <span className={`${badgeClass} bg-black/5 dark:bg-white/10`}>
          {preview.summary.transferMatchedPairs} transfer pairs matched
        </span>
        <span className={`${badgeClass} bg-black/5 dark:bg-white/10`}>
          {preview.summary.suggestedCategoryCount} categorized
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs text-black/50 dark:border-white/15 dark:text-white/50">
              <th className="p-2">Include</th>
              <th className="p-2">Date</th>
              <th className="p-2">Payee</th>
              <th className="p-2">Amount</th>
              <th className="p-2">Kind</th>
              <th className="p-2">Flags</th>
              <th className="p-2">Category</th>
            </tr>
          </thead>
          <tbody>
            {visibleDrafts.map((draft) => {
              const isChecked = !excluded.has(draft.index);
              return (
                <tr
                  key={draft.index}
                  className="border-b border-black/5 last:border-0 dark:border-white/10"
                >
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={draft.alreadyImported}
                      onChange={() => toggleIncluded(draft.index, draft.alreadyImported)}
                      className="h-4 w-4 rounded border-black/20 dark:border-white/25"
                    />
                  </td>
                  <td className="p-2 whitespace-nowrap">{draft.date}</td>
                  <td className="p-2">{draft.payee}</td>
                  <td className="p-2 whitespace-nowrap tabular-nums">
                    {formatSignedAmount(draft)}
                  </td>
                  <td className="p-2">
                    <span className={`${badgeClass} bg-black/5 dark:bg-white/10`}>
                      {draft.kind}
                    </span>
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {draft.alreadyImported && (
                        <span className={`${badgeClass} bg-black/10 dark:bg-white/15`}>
                          already imported
                        </span>
                      )}
                      {draft.inBatchDuplicate && !draft.alreadyImported && (
                        <span
                          className={`${badgeClass} bg-amber-500/10 text-amber-700 dark:text-amber-400`}
                        >
                          duplicate in file
                        </span>
                      )}
                      {draft.transferMatchIndex != null && (
                        <span
                          className={`${badgeClass} bg-blue-500/10 text-blue-700 dark:text-blue-400`}
                        >
                          ↔ row {draft.transferMatchIndex}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-2">
                    <select
                      value={categorySelections[draft.index] ?? ""}
                      onChange={(e) =>
                        setCategorySelections((prev) => ({
                          ...prev,
                          [draft.index]: e.target.value,
                        }))
                      }
                      className={`${inputClass} min-w-[10rem]`}
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {hiddenCount > 0 && (
          <p className="p-3 text-xs text-black/50 dark:text-white/50">
            … and {hiddenCount} more included on commit.
          </p>
        )}
      </div>

      {state && !state.ok && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}

      <div className="flex gap-2">
        <Link
          href="/import"
          className="rounded-md border border-black/10 px-4 py-2 text-sm font-medium dark:border-white/15"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
        >
          {pending ? "Importing..." : "Commit import"}
        </button>
      </div>
    </form>
  );
}
