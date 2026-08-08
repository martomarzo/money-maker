import Link from "next/link";
import { requireMembership } from "@/lib/session";
import { listRecentImportBatches, listStatementSummaries } from "@/lib/actions/import";
import { ImportBatchList } from "@/components/import-batch-list";

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  partial: "Partial",
  imported: "Imported",
};

const STATUS_CLASS: Record<string, string> = {
  new: "bg-black/5 dark:bg-white/10",
  partial: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  imported: "bg-green-500/15 text-green-700 dark:text-green-400",
};

function formatDateRange(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return from === to ? from : `${from} – ${to}`;
}

export default async function ImportPage() {
  await requireMembership();
  const [statements, batches] = await Promise.all([
    listStatementSummaries(),
    listRecentImportBatches(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Bank imports</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Statements extracted to <code>data/imports/extracted/</code> on this machine.
        </p>
      </div>

      {statements.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/15 p-8 text-center text-sm text-black/50 dark:border-white/20 dark:text-white/50">
          No extracted statements found. Run the extraction pipeline
          (<code>scripts/extract/extract.py</code>) to populate{" "}
          <code>data/imports/extracted/</code>.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {statements.map((s) => (
            <Link
              key={s.filename}
              href={`/import/${encodeURIComponent(s.filename)}`}
              className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 transition hover:border-black/20 sm:flex-row sm:items-center sm:justify-between dark:border-white/15 dark:hover:border-white/30"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.filename}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[s.status]}`}
                  >
                    {STATUS_LABEL[s.status]}
                  </span>
                </div>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {s.source} · {s.currencies.join(", ")} · {s.rowCount} rows ·{" "}
                  {formatDateRange(s.dateFrom, s.dateTo)}
                </span>
              </div>
              {s.warnings.length > 0 && (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  {s.warnings.length} warning{s.warnings.length === 1 ? "" : "s"}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      <ImportBatchList batches={batches} />
    </div>
  );
}
