"use client";

import { useRouter } from "next/navigation";

// Compact variant of ui.tsx's selectClass: same tokens, but auto-width so
// filters sit side by side in a wrapping toolbar instead of stacking full-width.
const filterSelectClass =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-ring";

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

interface MemberOption {
  id: string;
  displayName: string;
}

interface TransactionFiltersProps {
  accounts: AccountOption[];
  categories: CategoryOption[];
  members: MemberOption[];
  account?: string;
  category?: string;
  person?: string;
  type?: string;
  from?: string;
  to?: string;
}

const TYPE_OPTIONS = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
];

export function TransactionFilters({
  accounts,
  categories,
  members,
  account,
  category,
  person,
  type,
  from,
  to,
}: TransactionFiltersProps) {
  const router = useRouter();

  function updateParam(key: string, value: string) {
    const current: Record<string, string | undefined> = {
      account,
      category,
      person,
      type,
      from,
      to,
    };
    current[key] = value || undefined;

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(current)) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    router.push(qs ? `/transactions?${qs}` : "/transactions");
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
    <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-3">
      <select
        aria-label="Account"
        value={account ?? ""}
        onChange={(e) => updateParam("account", e.target.value)}
        className={filterSelectClass}
      >
        <option value="">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.currency})
          </option>
        ))}
      </select>

      <select
        aria-label="Category"
        value={category ?? ""}
        onChange={(e) => updateParam("category", e.target.value)}
        className={filterSelectClass}
      >
        <option value="">All categories</option>
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

      <select
        aria-label="Person"
        value={person ?? ""}
        onChange={(e) => updateParam("person", e.target.value)}
        className={filterSelectClass}
      >
        <option value="">Everyone</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName}
          </option>
        ))}
      </select>

      <select
        aria-label="Type"
        value={type ?? ""}
        onChange={(e) => updateParam("type", e.target.value)}
        className={filterSelectClass}
      >
        <option value="">All types</option>
        {TYPE_OPTIONS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      <input
        aria-label="From date"
        type="date"
        value={from ?? ""}
        onChange={(e) => updateParam("from", e.target.value)}
        className={filterSelectClass}
      />
      <input
        aria-label="To date"
        type="date"
        value={to ?? ""}
        onChange={(e) => updateParam("to", e.target.value)}
        className={filterSelectClass}
      />
    </div>
  );
}
