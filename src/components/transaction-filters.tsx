"use client";

import { useRouter } from "next/navigation";

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

const selectClass =
  "rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/30";

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
    <div className="flex flex-wrap gap-2 rounded-lg border border-black/10 p-3 dark:border-white/15">
      <select
        aria-label="Account"
        value={account ?? ""}
        onChange={(e) => updateParam("account", e.target.value)}
        className={selectClass}
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
        className={selectClass}
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
        className={selectClass}
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
        className={selectClass}
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
        className={selectClass}
      />
      <input
        aria-label="To date"
        type="date"
        value={to ?? ""}
        onChange={(e) => updateParam("to", e.target.value)}
        className={selectClass}
      />
    </div>
  );
}
