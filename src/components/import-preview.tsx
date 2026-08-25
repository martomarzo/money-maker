"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { commitStatement, type StatementPreview } from "@/lib/actions/import";
import { formatCents } from "@/lib/domain/money";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardTitle,
  ErrorText,
  inputClass,
  labelClass,
  selectClass,
} from "@/components/ui";

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
      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Import complete</h2>
        <ul className="flex flex-col gap-1 text-sm text-muted">
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
        <ButtonLink href="/import" size="sm" className="self-start">
          Back to imports
        </ButtonLink>
      </Card>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="filename" value={preview.filename} />
      <input type="hidden" name="accountChoices" value={accountChoicesJson} />
      <input type="hidden" name="excludedIndices" value={excludedIndicesJson} />
      <input type="hidden" name="categoryOverrides" value={categoryOverridesJson} />

      <Card className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{preview.filename}</h1>
            <p className="text-xs text-faint">
              {preview.source} · {preview.sourceFile}
            </p>
          </div>
          <span className="text-xs text-faint">
            {preview.dateFrom} – {preview.dateTo}
          </span>
        </div>
        {preview.warnings.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-xs text-warning">
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>Account mapping</CardTitle>
        {preview.currencies.map((currency) => {
          const choice = accountChoices[currency];
          const options = preview.existingAccountsByCurrency[currency] ?? [];
          return (
            <div key={currency} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1">
                <label className={labelClass}>{currency}</label>
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
                  className={selectClass}
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
                    <label className={labelClass}>Name</label>
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
                    <label className={labelClass}>Type</label>
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
                      className={selectClass}
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
      </Card>

      <div className="flex flex-wrap gap-2">
        <Badge tone="expense">{preview.summary.expenseCount} expense</Badge>
        <Badge tone="income">{preview.summary.incomeCount} income</Badge>
        <Badge>{preview.summary.transferCount} transfer</Badge>
        <Badge>{preview.summary.alreadyImportedCount} already imported</Badge>
        <Badge tone="warning">{preview.summary.inBatchDuplicateCount} in-file duplicates</Badge>
        <Badge>{preview.summary.transferMatchedPairs} transfer pairs matched</Badge>
        <Badge>{preview.summary.suggestedCategoryCount} categorized</Badge>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="sticky top-0 z-10 bg-surface-muted">
            <tr className="border-b border-border text-left text-xs text-muted">
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
                <tr key={draft.index} className="border-b border-border last:border-0">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={draft.alreadyImported}
                      onChange={() => toggleIncluded(draft.index, draft.alreadyImported)}
                      className="h-4 w-4 rounded border-border-strong"
                    />
                  </td>
                  <td className="p-2 whitespace-nowrap">{draft.date}</td>
                  <td className="p-2">{draft.payee}</td>
                  <td className="tnum p-2 whitespace-nowrap">{formatSignedAmount(draft)}</td>
                  <td className="p-2">
                    <Badge>{draft.kind}</Badge>
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {draft.alreadyImported && <Badge>already imported</Badge>}
                      {draft.inBatchDuplicate && !draft.alreadyImported && (
                        <Badge tone="warning">duplicate in file</Badge>
                      )}
                      {draft.transferMatchIndex != null && (
                        <Badge tone="accent">↔ row {draft.transferMatchIndex}</Badge>
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
                      className={`${selectClass} min-w-[10rem]`}
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
          <p className="p-3 text-xs text-faint">… and {hiddenCount} more included on commit.</p>
        )}
      </div>

      {state && !state.ok && <ErrorText>{state.error}</ErrorText>}

      <div className="flex gap-2">
        <ButtonLink href="/import" variant="secondary">
          Cancel
        </ButtonLink>
        <Button type="submit" disabled={pending}>
          {pending ? "Importing..." : "Commit import"}
        </Button>
      </div>
    </form>
  );
}
