"use client";

import { useActionState, useRef } from "react";
import { upsertBudget } from "@/lib/actions/budgets";
import { centsToDecimalString, formatCents } from "@/lib/domain/money";
import { Badge, EmptyState, ErrorText, inputClass } from "@/components/ui";
import type { ActionResult } from "@/lib/actions/auth";

export interface BudgetListRow {
  categoryId: string;
  name: string;
  icon: string | null;
  parentId: string | null;
  budgetId: string | null;
  budgetCents: number | null;
  actualCents: number;
}

export function BudgetList({
  rows,
  month,
  baseCurrency,
}: {
  rows: BudgetListRow[];
  month: string;
  baseCurrency: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No categories yet"
        description="Add categories in Settings to start setting budgets."
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((row) => (
        <BudgetRow key={row.categoryId} row={row} month={month} baseCurrency={baseCurrency} />
      ))}
    </ul>
  );
}

function BudgetRow({
  row,
  month,
  baseCurrency,
}: {
  row: BudgetListRow;
  month: string;
  baseCurrency: string;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(upsertBudget, null);
  const formRef = useRef<HTMLFormElement>(null);
  const isChild = row.parentId !== null;
  const hasBudget = row.budgetCents !== null;
  const budgetCents = row.budgetCents ?? 0;
  const over = hasBudget && row.actualCents > budgetCents;
  const pct = hasBudget && budgetCents > 0 ? Math.min(100, Math.round((row.actualCents / budgetCents) * 100)) : 0;

  function submit(e: React.SyntheticEvent<HTMLInputElement>) {
    e.currentTarget.form?.requestSubmit();
  }

  return (
    <li className={`flex flex-col gap-1.5 py-3 ${isChild ? "pl-7" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-5 shrink-0 text-center">{row.icon ?? "•"}</span>
          <span className={`truncate text-sm ${isChild ? "text-muted" : "font-semibold"}`}>
            {row.name}
          </span>
          {over && <Badge tone="expense">over</Badge>}
        </span>

        <div className="flex shrink-0 items-center gap-3">
          {hasBudget ? (
            <span className="tnum text-sm text-muted">
              {formatCents(row.actualCents, baseCurrency)} / {formatCents(budgetCents, baseCurrency)}
            </span>
          ) : (
            <span className="tnum text-sm text-faint">
              {row.actualCents !== 0 ? formatCents(row.actualCents, baseCurrency) : "—"}
            </span>
          )}
          <form ref={formRef} action={formAction}>
            <input type="hidden" name="categoryId" value={row.categoryId} />
            <input type="hidden" name="month" value={month} />
            <input
              name="amount"
              inputMode="decimal"
              placeholder="Set"
              defaultValue={hasBudget ? centsToDecimalString(budgetCents, baseCurrency) : ""}
              className={`${inputClass} max-w-28 text-right tnum`}
              onBlur={submit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
          </form>
        </div>
      </div>

      {hasBudget && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-chart-track">
          <div
            className={`h-full rounded-full ${over ? "bg-danger" : "bg-chart-expense"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {state && !state.ok && <ErrorText>{state.error}</ErrorText>}
    </li>
  );
}
