"use client";

import { useId, useState } from "react";
import type { MonthPoint } from "@/lib/reports";
import { decimalsFor, formatCents } from "@/lib/domain/money";
import { EmptyState } from "@/components/ui";

const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
}

/** Clean-number tick step for a max value, targeting ~`count` ticks. */
function niceTicks(maxValue: number, count = 4): number[] {
  if (maxValue <= 0) return [0, 1];
  const rawStep = maxValue / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  let step: number;
  if (residual > 5) step = 10 * magnitude;
  else if (residual > 2) step = 5 * magnitude;
  else if (residual > 1) step = 2 * magnitude;
  else step = magnitude;
  const ticks: number[] = [];
  for (let t = 0; t <= maxValue + step * 0.5; t += step) ticks.push(t);
  return ticks;
}

function roundedTopBarPath(x: number, y: number, width: number, height: number, radius: number) {
  if (height <= 0) return "";
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
}

interface TrendChartProps {
  points: MonthPoint[];
  baseCurrency: string;
}

const W = 720;
const H = 260;
const PAD_LEFT = 44;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const PLOT_W = W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;

/** Last-12-months grouped column chart (expense vs income), base currency.
 *  Owns hover/focus state for a per-month tooltip; ships a toggleable table
 *  view of the same 12 rows. */
export function TrendChart({ points, baseCurrency }: TrendChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tooltipId = useId();

  const decimals = decimalsFor(baseCurrency);
  const toMajor = (cents: number) => cents / 10 ** decimals;

  const allZero = points.every((p) => p.expenseCents === 0 && p.incomeCents === 0);
  const totalPending = points.reduce((s, p) => s + p.pendingRateCount, 0);

  if (allZero) {
    return <EmptyState title="No activity yet" description="Log a few expenses to see the trend build up." />;
  }

  const maxMajor = points.reduce(
    (m, p) => Math.max(m, toMajor(p.expenseCents), toMajor(p.incomeCents)),
    0,
  );
  const ticks = niceTicks(maxMajor, 4);
  const topTick = ticks[ticks.length - 1];

  const scaleY = (major: number) => (topTick > 0 ? (major / topTick) * PLOT_H : 0);

  const groupWidth = PLOT_W / points.length;
  const barW = Math.min(24, Math.max(3, (groupWidth * 0.6 - 2) / 2));
  const gap = 2;

  const tickFormatter = new Intl.NumberFormat("en-GB", {
    notation: "compact",
    maximumFractionDigits: 1,
  });

  const hovered = hoverIndex != null ? points[hoverIndex] : null;
  const hoveredCx = hoverIndex != null ? PAD_LEFT + groupWidth * (hoverIndex + 0.5) : 0;
  const tooltipLeftPct = Math.min(88, Math.max(12, (hoveredCx / W) * 100));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="inline-block h-2 w-3 rounded-sm bg-chart-expense" aria-hidden />
            Expenses
          </span>
          <span className="flex items-center gap-1.5 text-muted">
            <span className="inline-block h-2 w-3 rounded-sm bg-chart-income" aria-hidden />
            Income
          </span>
        </div>
        <div className="flex items-center gap-3">
          {totalPending > 0 && (
            <span className="text-xs text-warning">{totalPending} awaiting FX rate</span>
          )}
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className="text-xs font-medium text-muted hover:text-foreground"
            aria-expanded={showTable}
          >
            {showTable ? "Hide table" : "Show table"}
          </button>
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label="Monthly expenses and income, last 12 months"
          className="overflow-visible"
        >
          {/* Gridlines + y-axis ticks */}
          {ticks.map((t) => {
            const y = PAD_TOP + PLOT_H - scaleY(t);
            return (
              <g key={t}>
                <line
                  x1={PAD_LEFT}
                  x2={W - PAD_RIGHT}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted"
                  fontSize={10}
                >
                  {tickFormatter.format(t)}
                </text>
              </g>
            );
          })}

          {/* Bars + hit targets + x labels */}
          {points.map((p, i) => {
            const cx = PAD_LEFT + groupWidth * (i + 0.5);
            const expenseMajor = toMajor(p.expenseCents);
            const incomeMajor = toMajor(p.incomeCents);
            const expenseH = scaleY(expenseMajor);
            const incomeH = scaleY(incomeMajor);
            const baseline = PAD_TOP + PLOT_H;
            const expenseX = cx - gap / 2 - barW;
            const incomeX = cx + gap / 2;
            const [, monthNum] = p.month.split("-").map(Number);
            const isHovered = hoverIndex === i;

            return (
              <g key={p.month}>
                <path
                  d={roundedTopBarPath(expenseX, baseline - expenseH, barW, expenseH, 3)}
                  fill="var(--chart-expense)"
                  opacity={hoverIndex == null || isHovered ? 1 : 0.45}
                />
                <path
                  d={roundedTopBarPath(incomeX, baseline - incomeH, barW, incomeH, 3)}
                  fill="var(--chart-income)"
                  opacity={hoverIndex == null || isHovered ? 1 : 0.45}
                />
                <text
                  x={cx}
                  y={H - 6}
                  textAnchor="middle"
                  className="fill-muted"
                  fontSize={10}
                >
                  {MONTH_INITIALS[monthNum - 1]}
                </text>
                {/* Hit target for the whole month group */}
                <rect
                  x={PAD_LEFT + groupWidth * i}
                  y={PAD_TOP}
                  width={groupWidth}
                  height={PLOT_H}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-describedby={isHovered ? tooltipId : undefined}
                  aria-label={`${monthLabel(p.month)}: expenses ${formatCents(p.expenseCents, baseCurrency)}, income ${formatCents(p.incomeCents, baseCurrency)}`}
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex((v) => (v === i ? null : v))}
                  onFocus={() => setHoverIndex(i)}
                  onBlur={() => setHoverIndex((v) => (v === i ? null : v))}
                />
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-lg border border-border bg-surface p-2.5 text-xs shadow-lg"
            style={{ left: `${tooltipLeftPct}%` }}
          >
            <p className="mb-1 font-medium text-foreground">{monthLabel(hovered.month)}</p>
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-muted">
                  <span className="inline-block h-2 w-3 rounded-sm bg-chart-expense" aria-hidden />
                  Expenses
                </span>
                <span className="tnum font-semibold text-foreground">
                  {formatCents(hovered.expenseCents, baseCurrency)}
                </span>
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-muted">
                  <span className="inline-block h-2 w-3 rounded-sm bg-chart-income" aria-hidden />
                  Income
                </span>
                <span className="tnum font-semibold text-foreground">
                  {formatCents(hovered.incomeCents, baseCurrency)}
                </span>
              </span>
              <span className="mt-0.5 flex items-center justify-between gap-2 border-t border-border pt-0.5">
                <span className="text-muted">Net</span>
                <span className="tnum font-semibold text-foreground">
                  {formatCents(hovered.incomeCents - hovered.expenseCents, baseCurrency)}
                </span>
              </span>
            </div>
          </div>
        )}
      </div>

      {showTable && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th scope="col" className="px-3 py-2 font-medium">Month</th>
                <th scope="col" className="px-3 py-2 font-medium">Expenses</th>
                <th scope="col" className="px-3 py-2 font-medium">Income</th>
                <th scope="col" className="px-3 py-2 font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.month} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5">{monthLabel(p.month)}</td>
                  <td className="tnum px-3 py-1.5">{formatCents(p.expenseCents, baseCurrency)}</td>
                  <td className="tnum px-3 py-1.5">{formatCents(p.incomeCents, baseCurrency)}</td>
                  <td className="tnum px-3 py-1.5">
                    {formatCents(p.incomeCents - p.expenseCents, baseCurrency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
