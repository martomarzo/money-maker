"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { createCategoryRule, deleteCategoryRule } from "@/lib/actions/categories";

interface CategoryOption {
  id: string;
  parentId: string | null;
  name: string;
  icon: string | null;
}

interface AccountOption {
  id: string;
  name: string;
}

interface RuleRow {
  rule: {
    id: string;
    matchText: string;
    accountId: string | null;
    currency: string | null;
    categoryId: string;
    priority: number;
  };
  categoryName: string;
  categoryIcon: string | null;
}

const inputClass =
  "rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/30";

export function CategoryRulesPanel({
  rules,
  categories,
  accounts,
}: {
  rules: RuleRow[];
  categories: CategoryOption[];
  accounts: AccountOption[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(createCategoryRule, null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  function handleDelete(id: string) {
    if (!confirm("Delete this rule?")) return;
    setDeleteError(null);
    setDeletingId(id);
    startDelete(async () => {
      const result = await deleteCategoryRule(id);
      if (!result.ok) setDeleteError(result.error);
      else router.refresh();
      setDeletingId(null);
    });
  }

  const parents = categories.filter((c) => c.parentId === null);
  const childrenByParent = new Map<string, CategoryOption[]>();
  for (const c of categories) {
    if (c.parentId) {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Auto-categorization rules</h2>
        <p className="text-sm text-black/60 dark:text-white/60">
          Suggested at import preview time when a transaction&rsquo;s description contains
          the match text. Lower priority number wins ties.
        </p>
      </div>

      {rules.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">No rules yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map(({ rule, categoryName, categoryIcon }) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/15"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">&ldquo;{rule.matchText}&rdquo;</span>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {categoryIcon ? `${categoryIcon} ` : ""}
                  {categoryName}
                  {rule.currency ? ` · ${rule.currency}` : ""}
                  {rule.accountId
                    ? ` · ${accounts.find((a) => a.id === rule.accountId)?.name ?? "account"}`
                    : ""}
                  {` · priority ${rule.priority}`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(rule.id)}
                disabled={isDeleting && deletingId === rule.id}
                className="rounded-md border border-red-600/40 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-60 dark:border-red-400/40 dark:text-red-400"
              >
                {isDeleting && deletingId === rule.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          ))}
        </div>
      )}

      {deleteError && <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>}

      <form
        ref={formRef}
        action={formAction}
        className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="matchText" className="text-sm font-medium">
            Match text
          </label>
          <input
            id="matchText"
            name="matchText"
            type="text"
            required
            minLength={2}
            maxLength={80}
            placeholder="e.g. glovo"
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="categoryId" className="text-sm font-medium">
            Category
          </label>
          <select
            id="categoryId"
            name="categoryId"
            required
            defaultValue=""
            className={inputClass}
          >
            <option value="" disabled>
              Select a category
            </option>
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

        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="currency" className="text-sm font-medium">
              Currency <span className="text-black/40 dark:text-white/40">(optional)</span>
            </label>
            <input
              id="currency"
              name="currency"
              type="text"
              maxLength={3}
              placeholder="EUR"
              className={inputClass}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="accountId" className="text-sm font-medium">
              Account <span className="text-black/40 dark:text-white/40">(optional)</span>
            </label>
            <select id="accountId" name="accountId" defaultValue="" className={inputClass}>
              <option value="">Any account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="priority" className="text-sm font-medium">
            Priority
          </label>
          <input
            id="priority"
            name="priority"
            type="number"
            defaultValue={0}
            className={inputClass}
          />
        </div>

        {state && !state.ok && (
          <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
        >
          {pending ? "Saving..." : "Add rule"}
        </button>
      </form>
    </section>
  );
}
