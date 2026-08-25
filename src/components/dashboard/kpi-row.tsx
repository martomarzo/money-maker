import type { PeriodTotals } from "@/lib/reports";
import { formatCents } from "@/lib/domain/money";
import { Card, CardTitle } from "@/components/ui";

interface KpiRowProps {
  totals: PeriodTotals;
}

interface Tile {
  label: string;
  cents: number;
  colorClass: string;
  currencies: { currency: string; cents: number }[];
}

/** Three base-currency stat tiles (expenses / income / net) with per-currency
 *  subtotals underneath and an "awaiting FX rate" marker. Server component. */
export function KpiRow({ totals }: KpiRowProps) {
  const { baseCurrency, expenseCents, incomeCents, netCents, pendingRateCount, byCurrency } =
    totals;

  const tiles: Tile[] = [
    {
      label: "Expenses",
      cents: expenseCents,
      colorClass: "text-foreground",
      currencies: byCurrency
        .filter((c) => c.expenseCents !== 0)
        .map((c) => ({ currency: c.currency, cents: c.expenseCents })),
    },
    {
      label: "Income",
      cents: incomeCents,
      colorClass: "text-foreground",
      currencies: byCurrency
        .filter((c) => c.incomeCents !== 0)
        .map((c) => ({ currency: c.currency, cents: c.incomeCents })),
    },
    {
      label: "Net",
      cents: netCents,
      colorClass: netCents > 0 ? "text-income" : netCents < 0 ? "text-expense" : "text-foreground",
      currencies: byCurrency
        .filter((c) => c.incomeCents - c.expenseCents !== 0)
        .map((c) => ({ currency: c.currency, cents: c.incomeCents - c.expenseCents })),
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {tiles.map((tile) => (
        <Card key={tile.label} className="flex flex-col gap-1.5">
          <CardTitle>{tile.label}</CardTitle>
          <span className={`tnum text-2xl font-semibold ${tile.colorClass}`}>
            {tile.label === "Net" && netCents > 0 ? "+" : ""}
            {formatCents(tile.cents, baseCurrency)}
          </span>
          {tile.currencies.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
              {tile.currencies.map((c) => (
                <span key={c.currency} className="tnum">
                  {c.cents > 0 && tile.label === "Net" ? "+" : ""}
                  {formatCents(c.cents, c.currency)}
                </span>
              ))}
            </div>
          )}
          {pendingRateCount > 0 && (
            <span className="text-xs text-warning">
              {pendingRateCount} awaiting FX rate
            </span>
          )}
        </Card>
      ))}
    </div>
  );
}
