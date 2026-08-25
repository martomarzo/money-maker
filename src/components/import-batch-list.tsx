"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { matchUnlinkedTransfers, undoImportBatch } from "@/lib/actions/import";
import { Button, ErrorText } from "@/components/ui";

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
        <h2 className="text-sm font-medium text-muted">Recent import batches</h2>
        <Button type="button" variant="secondary" size="sm" onClick={handleMatch} disabled={isMatching}>
          {isMatching ? "Matching..." : "Match unlinked transfers"}
        </Button>
      </div>

      {matchResult && <p className="text-sm text-muted">{matchResult}</p>}
      <ErrorText>{error}</ErrorText>

      {batches.length === 0 ? (
        <p className="text-sm text-faint">No imports committed yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {batches.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{b.filename}</span>
                <span className="text-xs text-faint">
                  {b.source} · {formatDateTime(b.createdAt)} · {b.importedCount} imported,{" "}
                  {b.skippedDuplicateCount} duplicate, {b.skippedFilteredCount} excluded
                </span>
              </div>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => handleUndo(b.id)}
                disabled={isUndoing && undoingId === b.id}
                className="shrink-0"
              >
                {isUndoing && undoingId === b.id ? "Undoing..." : "Undo"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
