"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  convertTransferLeg,
  unlinkTransfer,
  updateTransferLeg,
} from "@/lib/actions/transfers";
import { deleteTransaction } from "@/lib/actions/transactions";
import { formatCents } from "@/lib/domain/money";
import { Badge, Button, ErrorText, inputClass, labelClass, selectClass } from "@/components/ui";

interface CategoryOption {
  id: string;
  parentId: string | null;
  name: string;
  icon: string | null;
}

export interface TransferLegView {
  id: string;
  amountCents: number; // signed: negative = outflow
  currency: string;
  date: string;
  payee: string | null;
  notes: string | null;
  categoryId: string | null;
  accountName: string;
  peer: { id: string; accountName: string; amountCents: number; currency: string } | null;
}

export function TransferEditForm({
  leg,
  categories,
}: {
  leg: TransferLegView;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateTransferLeg, null);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) router.push("/transactions");
  }, [state, router]);

  const outflow = leg.amountCents < 0;
  const naturalType = outflow ? "expense" : "income";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "Something went wrong");
        return;
      }
      if (after) after();
      else router.refresh();
    });
  }

  const parents = categories.filter((c) => !c.parentId);
  const kidsOf = (id: string) => categories.filter((c) => c.parentId === id);

  return (
    <div className="flex flex-col gap-6">
      {/* What this leg is */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted/60 p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Badge>{outflow ? "out of" : "into"}</Badge>
            <span className="font-medium">{leg.accountName}</span>
          </span>
          <span className={`tnum font-semibold ${outflow ? "text-expense" : "text-income"}`}>
            {outflow ? "-" : "+"}
            {formatCents(Math.abs(leg.amountCents), leg.currency)}
          </span>
        </div>
        {leg.peer ? (
          <div className="flex items-center justify-between gap-3 text-muted">
            <span>
              linked with {leg.peer.amountCents < 0 ? "outflow from" : "inflow to"}{" "}
              <span className="font-medium text-foreground">{leg.peer.accountName}</span>
            </span>
            <span className="tnum">
              {formatCents(Math.abs(leg.peer.amountCents), leg.peer.currency)}
            </span>
          </div>
        ) : (
          <p className="text-muted">
            Unlinked transfer leg — the other side isn&apos;t matched to any account.
          </p>
        )}
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={leg.id} />
        <div className="flex flex-col gap-1">
          <label htmlFor="date" className={labelClass}>
            Date{leg.peer ? " (applies to both legs)" : ""}
          </label>
          <input id="date" name="date" type="date" required defaultValue={leg.date} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="payee" className={labelClass}>
            Name / payee
          </label>
          <input id="payee" name="payee" type="text" defaultValue={leg.payee ?? ""} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="categoryId" className={labelClass}>
            Category (optional — transfers stay out of spending reports)
          </label>
          <select id="categoryId" name="categoryId" defaultValue={leg.categoryId ?? ""} className={selectClass}>
            <option value="">Uncategorized</option>
            {parents.map((p) => {
              const kids = kidsOf(p.id);
              const label = `${p.icon ? `${p.icon} ` : ""}${p.name}`;
              return kids.length === 0 ? (
                <option key={p.id} value={p.id}>{label}</option>
              ) : (
                <optgroup key={p.id} label={label}>
                  <option value={p.id}>{label}</option>
                  {kids.map((c) => (
                    <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="notes" className={labelClass}>
            Notes
          </label>
          <textarea id="notes" name="notes" rows={2} defaultValue={leg.notes ?? ""} className={inputClass} />
        </div>
        {state && !state.ok && <ErrorText>{state.error}</ErrorText>}
        <Button type="submit" disabled={pending} className="w-full sm:w-auto sm:self-start">
          {pending ? "Saving..." : "Save changes"}
        </Button>
      </form>

      {/* Structural changes */}
      <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <span className={labelClass}>Not actually a transfer?</span>
        {leg.peer ? (
          <>
            <p className="text-sm text-muted">
              This leg is linked to another account. Unlink first; both legs stay as transfer legs
              and can then be converted or deleted separately.
            </p>
            <Button type="button" variant="secondary" size="sm" disabled={busy} className="self-start"
              onClick={() => run(() => unlinkTransfer(leg.id))}>
              Unlink the two legs
            </Button>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={busy}
              onClick={() => run(() => convertTransferLeg(leg.id, naturalType), () => router.push(`/transactions/${leg.id}/edit`))}>
              Convert to {naturalType}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy}
              onClick={() => run(() => convertTransferLeg(leg.id, naturalType === "expense" ? "income" : "expense"), () => router.push(`/transactions/${leg.id}/edit`))}>
              Convert to {naturalType === "expense" ? "income" : "expense"}
            </Button>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </div>

      <Button type="button" variant="danger" size="sm" disabled={busy} className="self-start"
        onClick={() => {
          if (!confirm(leg.peer ? "Delete both legs of this transfer?" : "Delete this transfer leg?")) return;
          run(() => deleteTransaction(leg.id), () => router.push("/transactions"));
        }}>
        Delete{leg.peer ? " both legs" : ""}
      </Button>
    </div>
  );
}
