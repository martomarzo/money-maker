"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { categorizeAllMatching, setTransactionCategory } from "@/lib/actions/categorize";

export interface PickerCategory {
  id: string;
  parentId: string | null;
  name: string;
  icon: string | null;
}

/** Inline category select for a transaction row. After a change, offers a
 *  one-tap "apply to all <payee>" that creates a rule and back-fills
 *  uncategorized matches. */
export function RowCategoryPicker({
  transactionId,
  categoryId,
  payee,
  categories,
}: {
  transactionId: string;
  categoryId: string | null;
  payee: string | null;
  categories: PickerCategory[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [offer, setOffer] = useState<string | null>(null); // categoryId just chosen
  const [note, setNote] = useState<string | null>(null);

  const parents = categories.filter((c) => !c.parentId);
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id);

  function change(next: string) {
    setNote(null);
    start(async () => {
      const r = await setTransactionCategory(transactionId, next || null);
      if (!r.ok) {
        setNote(r.error);
        return;
      }
      setOffer(next && payee ? next : null);
      router.refresh();
    });
  }

  function applyAll() {
    if (!offer || !payee) return;
    start(async () => {
      const r = await categorizeAllMatching(payee, offer);
      setOffer(null);
      setNote(r.ok ? `Rule saved · ${r.applied ?? 0} more categorized` : r.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
      <select
        aria-label="Category"
        value={categoryId ?? ""}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        className="max-w-36 rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-muted outline-none focus:border-accent"
      >
        <option value="">Uncategorized</option>
        {parents.map((p) => {
          const kids = childrenOf(p.id);
          const label = `${p.icon ? `${p.icon} ` : ""}${p.name}`;
          return kids.length === 0 ? (
            <option key={p.id} value={p.id}>
              {label}
            </option>
          ) : (
            <optgroup key={p.id} label={label}>
              <option value={p.id}>{label}</option>
              {kids.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ""}
                  {c.name}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      {offer && payee && (
        <button
          type="button"
          onClick={applyAll}
          disabled={pending}
          className="text-[11px] font-medium text-accent hover:underline"
        >
          Always for “{payee.length > 24 ? `${payee.slice(0, 24)}…` : payee}”
        </button>
      )}
      {note && <span className="text-[11px] text-muted">{note}</span>}
    </div>
  );
}
