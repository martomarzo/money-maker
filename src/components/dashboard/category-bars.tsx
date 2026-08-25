import Link from "next/link";
import type { CategoryTotal } from "@/lib/reports";
import { formatCents } from "@/lib/domain/money";
import { CardTitle, EmptyState } from "@/components/ui";

interface CategoryBarsProps {
  title: string;
  totals: CategoryTotal[];
  baseCurrency: string;
  markClass: string; // e.g. "bg-chart-expense" | "bg-chart-income"
  range?: { from: string; to: string };
  emptyLabel: string;
}

function rowHref(categoryId: string | null, range?: { from: string; to: string }) {
  const params = new URLSearchParams();
  params.set("category", categoryId ?? "none");
  if (range) {
    params.set("from", range.from);
    params.set("to", range.to);
  }
  const qs = params.toString();
  return qs ? `/transactions?${qs}` : "/transactions";
}

function Bar({
  icon,
  name,
  cents,
  width,
  sharePct,
  baseCurrency,
  markClass,
  href,
  indent = false,
}: {
  icon: string | null;
  name: string;
  cents: number;
  width: number;
  sharePct: number;
  baseCurrency: string;
  markClass: string;
  href: string;
  indent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex flex-col gap-1 rounded-lg px-2 py-1.5 -mx-2 transition-colors hover:bg-surface-muted ${indent ? "ml-6" : ""}`}
    >
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          {!indent && <span className="w-5 text-center">{icon ?? "•"}</span>}
          <span className="truncate">{name}</span>
        </span>
        <span className="tnum shrink-0 flex items-baseline gap-2">
          <span className="font-medium">{formatCents(cents, baseCurrency)}</span>
          <span className="text-xs text-faint">{sharePct.toFixed(0)}%</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-chart-track">
        <div
          className={`h-full rounded-full ${markClass}`}
          style={{ width: `${Math.min(100, Math.max(0, width))}%` }}
        />
      </div>
    </Link>
  );
}

/** Horizontal bar breakdown by category (parents, with up to 3 children shown
 *  indented underneath). Single series — no legend needed, values are direct
 *  labels on each bar. Server component. */
export function CategoryBars({
  title,
  totals,
  baseCurrency,
  markClass,
  range,
  emptyLabel,
}: CategoryBarsProps) {
  const max = totals.reduce((m, t) => Math.max(m, t.cents), 0);
  const total = totals.reduce((s, t) => s + t.cents, 0);
  const pendingRateCount = totals.reduce((s, t) => s + t.pendingRateCount, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {pendingRateCount > 0 && (
          <span className="text-xs text-warning">{pendingRateCount} awaiting FX rate</span>
        )}
      </div>
      {totals.length === 0 ? (
        <EmptyState title={emptyLabel} />
      ) : (
        <div className="flex flex-col gap-1">
          {totals.map((t) => {
            const width = max > 0 ? (t.cents / max) * 100 : 0;
            const sharePct = total > 0 ? (t.cents / total) * 100 : 0;
            const topChildren = t.children.slice(0, 3);
            return (
              <div key={t.categoryId ?? "uncategorized"} className="flex flex-col gap-1">
                <Bar
                  icon={t.icon}
                  name={t.name}
                  cents={t.cents}
                  width={width}
                  sharePct={sharePct}
                  baseCurrency={baseCurrency}
                  markClass={markClass}
                  href={rowHref(t.categoryId, range)}
                />
                {topChildren.map((c) => (
                  <Bar
                    key={c.categoryId}
                    icon={c.icon}
                    name={c.name}
                    cents={c.cents}
                    width={max > 0 ? (c.cents / max) * 100 : 0}
                    sharePct={total > 0 ? (c.cents / total) * 100 : 0}
                    baseCurrency={baseCurrency}
                    markClass={markClass}
                    href={rowHref(c.categoryId, range)}
                    indent
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
