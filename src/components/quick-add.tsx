"use client";

import { startTransition, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { createTransaction } from "@/lib/actions/transactions";
import { decimalsFor, formatCents, toCents } from "@/lib/domain/money";
import { Button, ErrorText, inputClass } from "@/components/ui";

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

const STORAGE_KEY = "mm.quickadd.v1";
interface Prefs {
  accountId?: string;
  categoryUse?: Record<string, number>;
}

function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Prefs;
  } catch {
    return {};
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* private mode etc. */
  }
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function QuickAdd({
  accounts,
  categories,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
}) {
  const [prefs, setPrefs] = useState<Prefs>({});
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [date, setDate] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Device defaults: last account, category usage counts.
  useEffect(() => {
    const p = loadPrefs();
    // Deferred so the hydrated markup matches the server render first.
    startTransition(() => {
      setPrefs(p);
      if (p.accountId && accounts.some((a) => a.id === p.accountId)) setAccountId(p.accountId);
      setDate(today());
    });
  }, [accounts]);

  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? "EUR";
  const decimals = decimalsFor(currency);

  const sortedCategories = useMemo(() => {
    const use = prefs.categoryUse ?? {};
    const byId = new Map(categories.map((c) => [c.id, c]));
    return [...categories]
      .map((c) => ({
        ...c,
        label: c.parentId ? c.name : c.name,
        parentName: c.parentId ? (byId.get(c.parentId)?.name ?? null) : null,
        icon: c.icon ?? (c.parentId ? (byId.get(c.parentId)?.icon ?? null) : null),
        uses: use[c.id] ?? 0,
      }))
      .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  }, [categories, prefs.categoryUse]);

  function press(key: string) {
    setError(null);
    setAmount((cur) => {
      if (key === "⌫") return cur.slice(0, -1);
      if (key === ".") {
        if (decimals === 0 || cur.includes(".")) return cur;
        return cur === "" ? "0." : `${cur}.`;
      }
      const [, frac] = cur.split(".");
      if (frac !== undefined && frac.length >= decimals) return cur;
      if (cur === "0") return key;
      if (cur.replace(".", "").length >= 12) return cur;
      return `${cur}${key}`;
    });
  }

  let cents = 0;
  try {
    cents = amount ? toCents(amount, currency) : 0;
  } catch {
    cents = 0;
  }
  const canSave = cents > 0 && Boolean(accountId) && !pending;

  function save() {
    if (!canSave) return;
    setError(null);
    const fd = new FormData();
    fd.set("type", "expense");
    fd.set("accountId", accountId);
    fd.set("amount", amount);
    fd.set("date", date || today());
    if (categoryId) fd.set("categoryId", categoryId);
    if (payee.trim()) fd.set("payee", payee.trim());
    const savedCents = cents;
    const savedCategory = categoryId ? categories.find((c) => c.id === categoryId) : null;
    start(async () => {
      const result = await createTransaction(null, fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const next: Prefs = {
        accountId,
        categoryUse: { ...(prefs.categoryUse ?? {}) },
      };
      if (categoryId) next.categoryUse![categoryId] = (next.categoryUse![categoryId] ?? 0) + 1;
      savePrefs(next);
      setPrefs(next);
      setToast(
        `Saved ${formatCents(savedCents, currency)}${savedCategory ? ` · ${savedCategory.name}` : ""}`,
      );
      setAmount("");
      setPayee("");
      setCategoryId(null);
      setShowDetails(false);
      setTimeout(() => setToast(null), 2500);
    });
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted">
        Add an account first — <Link href="/accounts/new" className="text-accent underline">create one</Link>.
      </p>
    );
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", decimals === 0 ? "" : ".", "0", "⌫"];

  return (
    <div className="flex flex-col gap-5">
      {/* Amount */}
      <div className="flex flex-col items-center gap-1 rounded-2xl bg-surface px-4 py-5 ring-1 ring-border">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">{currency}</span>
        <output
          aria-live="polite"
          className={`tnum text-5xl font-semibold tracking-tight ${amount ? "" : "text-faint"}`}
        >
          {amount || (decimals === 0 ? "0" : "0.00")}
        </output>
        {toast && <span className="mt-1 text-sm font-medium text-income">{toast}</span>}
      </div>

      {/* Accounts */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAccountId(a.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              a.id === accountId
                ? "border-accent bg-accent text-on-accent"
                : "border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            {a.name} <span className="opacity-70">{a.currency}</span>
          </button>
        ))}
      </div>

      {/* Categories */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {sortedCategories.map((c) => {
          const active = c.id === categoryId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(active ? null : c.id)}
              title={c.parentName ? `${c.parentName} › ${c.name}` : c.name}
              className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-center transition-colors ${
                active
                  ? "border-accent bg-accent-soft text-accent-strong"
                  : "border-border bg-surface hover:bg-surface-muted"
              }`}
            >
              <span className="text-xl leading-none">{c.icon ?? "•"}</span>
              <span className="line-clamp-2 text-[11px] leading-tight">{c.name}</span>
            </button>
          );
        })}
      </div>

      {/* Optional details */}
      {showDetails ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            type="text"
            placeholder="Payee (optional)"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            className={inputClass}
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowDetails(true)}
          className="self-start text-sm text-muted hover:text-foreground"
        >
          + payee / date
        </button>
      )}

      <ErrorText>{error}</ErrorText>

      {/* Keypad (mobile) + save */}
      <div className="grid grid-cols-3 gap-2 md:hidden">
        {keys.map((k, i) =>
          k === "" ? (
            <span key={i} />
          ) : (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              className="tnum h-14 rounded-xl border border-border bg-surface text-xl font-medium active:bg-surface-muted"
              aria-label={k === "⌫" ? "Delete" : k}
            >
              {k}
            </button>
          ),
        )}
      </div>
      <div className="hidden md:block">
        <input
          inputMode="decimal"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className={`${inputClass} tnum text-lg`}
          autoFocus
        />
      </div>

      <div className="flex gap-2">
        <Button type="button" size="lg" className="flex-1" disabled={!canSave} onClick={save}>
          {pending ? "Saving..." : "Save expense"}
        </Button>
        <Link
          href="/transactions/new"
          className="flex h-12 items-center rounded-lg border border-border px-4 text-sm font-medium text-muted hover:text-foreground"
        >
          Full form
        </Link>
      </div>
    </div>
  );
}
