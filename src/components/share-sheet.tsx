"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shareTransaction, unshareTransaction, updateSplit } from "@/lib/actions/shares";
import { centsToDecimalString, formatCents, toCents } from "@/lib/domain/money";
import { Badge, Button, ErrorText, inputClass, labelClass, selectClass } from "@/components/ui";

interface HouseholdOption {
  id: string;
  name: string;
}

interface SplitLineView {
  userId: string;
  displayName: string;
  shareCents: number;
}

export interface ShareSheetProps {
  transactionId: string;
  amountCents: number;
  currency: string;
  households: HouseholdOption[];
  share: { householdId: string; householdName: string; splits: SplitLineView[] } | null;
  currentUserId: string;
}

/** Share / unshare a transaction with a household and edit the split. */
export function ShareSheet({
  transactionId,
  amountCents,
  currency,
  households,
  share,
  currentUserId,
}: ShareSheetProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [householdId, setHouseholdId] = useState(share?.householdId ?? households[0]?.id ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (share?.splits ?? []).map((s) => [s.userId, centsToDecimalString(s.shareCents, currency)]),
    ),
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  const draftTotal = Object.values(draft).reduce((sum, v) => {
    try {
      return sum + toCents(v || "0", currency);
    } catch {
      return Number.NaN;
    }
  }, 0);
  const draftOk = Number.isFinite(draftTotal) && draftTotal === amountCents;

  if (households.length === 0) {
    return (
      <p className="text-sm text-muted">
        Join or create a household to share this transaction.
      </p>
    );
  }

  if (!share) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Private to you. Share it to make it visible to a household — it stays in your ledger.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="share-household" className={labelClass}>
              Household
            </label>
            <select
              id="share-household"
              value={householdId}
              onChange={(e) => setHouseholdId(e.target.value)}
              className={selectClass}
            >
              {households.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            disabled={pending || !householdId}
            onClick={() => run(() => shareTransaction(transactionId, householdId))}
          >
            {pending ? "Sharing..." : "Share"}
          </Button>
        </div>
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Shared with</span>
        <Badge tone="accent">{share.householdName}</Badge>
        <span className="text-muted">· split</span>
        {!editing && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit split
          </Button>
        )}
        <Button
          type="button"
          variant="danger"
          size="sm"
          className="ml-auto"
          disabled={pending}
          onClick={() => run(() => unshareTransaction(transactionId))}
        >
          Unshare
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {share.splits.map((s) => (
          <li key={s.userId} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{s.userId === currentUserId ? "You" : s.displayName}</span>
            {editing ? (
              <input
                inputMode="decimal"
                value={draft[s.userId] ?? ""}
                onChange={(e) => setDraft({ ...draft, [s.userId]: e.target.value })}
                className={`${inputClass} tnum max-w-32 text-right`}
                aria-label={`Share for ${s.displayName}`}
              />
            ) : (
              <span className="tnum font-medium">{formatCents(s.shareCents, currency)}</span>
            )}
          </li>
        ))}
      </ul>

      {editing && (
        <div className="flex flex-col gap-2">
          <p className={`text-xs ${draftOk ? "text-muted" : "text-danger"}`}>
            {Number.isFinite(draftTotal)
              ? `${formatCents(draftTotal, currency)} of ${formatCents(amountCents, currency)}`
              : "Enter valid amounts"}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || !draftOk}
              onClick={() =>
                run(() =>
                  updateSplit(
                    transactionId,
                    share.splits.map((s) => ({
                      userId: s.userId,
                      shareCents: toCents(draft[s.userId] || "0", currency),
                    })),
                  ),
                )
              }
            >
              Save split
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
