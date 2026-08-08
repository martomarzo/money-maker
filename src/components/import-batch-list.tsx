"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { matchUnlinkedTransfers, undoImportBatch } from "@/lib/actions/import";

interface BatchRow {
  id: string;
  filename: string;
  source: string;
  createdAt: Date;
  importedCount: number;
  skippedDuplicateCount: number;
  skippedFilteredCount: number;
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function ImportBatchList({ batches }: { batches: BatchRow[] }) {
  const router = useRouter();
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [isUndoing, startUndo] = useTransition();
  const [isMatching, startMatch] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<string | null>(null);

  function handleUndo(id: string) {
    if (!confirm("Undo this import? All transactions it created will be removed.")) return;
    setError(null);
    setUndoingId(id);
    startUndo(async () => {
      const result = await undoImportBatch(id);
      if (!result.ok) setError(result.error);
      else router.refresh();
      setUndoingId(null);
    });
  }

  function handleMatch() {
    setError(null);
    setMatchResult(null);
    startMatch(async () => {
      const result = await matchUnlinkedTransfers();
      if (!result.ok) setError(result.error);
      else {
        setMatchResult(
          result.linked === 0
            ? "No new transfer pairs found."
            : `Linked ${result.linked} transfer pair${result.linked === 1 ? "" : "s"}.`,
        );
        router.refresh();
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-black/60 dark:text-white/60">
          Recent import batches
        </h2>
        <button
          type="button"
          onClick={handleMatch}
          disabled={isMatching}
          className="rounded-md border border-black/10 px-3 py-1.5 text-xs font-medium disabled:opacity-60 dark:border-white/15"
        >
          {isMatching ? "Matching..." : "Match unlinked transfers"}
        </button>
      </div>

      {matchResult && (
        <p className="text-sm text-black/70 dark:text-white/70">{matchResult}</p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {batches.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No imports committed yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {batches.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/15"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{b.filename}</span>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {b.source} · {formatDateTime(b.createdAt)} · {b.importedCount} imported,{" "}
                  {b.skippedDuplicateCount} duplicate, {b.skippedFilteredCount} excluded
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleUndo(b.id)}
                disabled={isUndoing && undoingId === b.id}
                className="shrink-0 rounded-md border border-red-600/40 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-60 dark:border-red-400/40 dark:text-red-400"
              >
                {isUndoing && undoingId === b.id ? "Undoing..." : "Undo"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
