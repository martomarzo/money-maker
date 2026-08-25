import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listRecentImportBatches, listStatementSummaries } from "@/lib/actions/import";
import { ImportBatchList } from "@/components/import-batch-list";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  partial: "Partial",
  imported: "Imported",
};

const STATUS_TONE: Record<string, "neutral" | "warning" | "income"> = {
  new: "neutral",
  partial: "warning",
  imported: "income",
};

function formatDateRange(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return from === to ? from : `${from} – ${to}`;
}

export default async function ImportPage() {
  await requireUser();
  const [statements, batches] = await Promise.all([
    listStatementSummaries(),
    listRecentImportBatches(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-8">
      <PageHeader
        title="Bank imports"
        description={
          <>
            Statements extracted to <code>data/imports/extracted/</code> on this machine.
          </>
        }
      />

      {statements.length === 0 ? (
        <EmptyState
          title="No extracted statements found"
          description={
            <>
              Run the extraction pipeline (<code>scripts/extract/extract.py</code>) to populate{" "}
              <code>data/imports/extracted/</code>.
            </>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {statements.map((s) => (
            <Link
              key={s.filename}
              href={`/import/${encodeURIComponent(s.filename)}`}
              className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.filename}</span>
                  <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                </div>
                <span className="text-xs text-faint">
                  {s.source} · {s.currencies.join(", ")} · {s.rowCount} rows ·{" "}
                  {formatDateRange(s.dateFrom, s.dateTo)}
                </span>
              </div>
              {s.warnings.length > 0 && (
                <span className="text-xs text-warning">
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
