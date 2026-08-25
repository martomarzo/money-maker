import Link from "next/link";
import type { TransactionListRow } from "@/lib/queries";
import { formatCents, toCents } from "@/lib/domain/money";
import { Badge } from "@/components/ui";
import { RowCategoryPicker, type PickerCategory } from "@/components/row-category-picker";

export type TransactionType = "expense" | "income" | "transfer";
export type TransactionRow = TransactionListRow;

export function isTransactionType(value: string | undefined): value is TransactionType {
  return value === "expense" || value === "income" || value === "transfer";
}

export function typeLabel(type: TransactionType): string {
  if (type === "income") return "Income";
  if (type === "transfer") return "Transfer";
  return "Expense";
}

export function typeMarker(type: TransactionType): string {
  if (type === "income") return "↑";
  if (type === "transfer") return "⇄";
  return "↓";
}

export function formatSignedAmount(
  type: TransactionType,
  amount: string,
  currency: string,
): string {
  const cents = toCents(amount, currency);
  if (type === "expense") return `-${formatCents(cents, currency)}`;
  if (type === "income") return `+${formatCents(cents, currency)}`;
  return formatCents(cents, currency);
}

export function formatDateHeading(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export function amountColorClass(type: TransactionType): string {
  if (type === "expense") return "text-expense";
  if (type === "income") return "text-income";
  return "text-muted";
}

export function TransactionRowItem({
  row,
  showDate = false,
  categories,
}: {
  row: TransactionRow;
  showDate?: boolean;
  /** When given, renders an inline category picker (list view). */
  categories?: PickerCategory[];
}) {
  const { transaction: t, accountName, categoryName, categoryIcon, share } = row;
  const label = t.payee ?? categoryName ?? typeLabel(t.type);
  const icon = categoryIcon ?? typeMarker(t.type);
  const meta = [showDate ? t.date : null, accountName].filter(Boolean).join(" · ");

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-base">
          {icon}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2 truncate text-sm font-medium">
            <span className="truncate">{label}</span>
            {share && <Badge tone="accent">{share.householdName}</Badge>}
          </span>
          <span className="truncate text-xs text-muted">{meta}</span>
        </div>
      </div>
      <span className={`tnum shrink-0 text-sm font-semibold ${amountColorClass(t.type)}`}>
        {formatSignedAmount(t.type, t.amount, t.currency)}
      </span>
    </>
  );

  const className =
    "flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 transition-colors";

  if (categories) {
    // List view: the label links to the editor; the picker sits beside it
    // (interactive controls can't nest inside the link).
    return (
      <div className={`${className} hover:border-border-strong`}>
        <Link href={`/transactions/${t.id}/edit`} className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-base">
            {icon}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 truncate text-sm font-medium">
              <span className="truncate">{label}</span>
              {share && <Badge tone="accent">{share.householdName}</Badge>}
            </span>
            <span className="truncate text-xs text-muted">{meta}</span>
          </span>
        </Link>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`tnum text-sm font-semibold ${amountColorClass(t.type)}`}>
            {formatSignedAmount(t.type, t.amount, t.currency)}
          </span>
          <RowCategoryPicker
            transactionId={t.id}
            categoryId={t.categoryId}
            payee={t.payee}
            categories={categories}
          />
        </div>
      </div>
    );
  }

  return (
    <Link
      href={`/transactions/${t.id}/edit`}
      className={`${className} hover:border-border-strong hover:bg-surface-muted`}
    >
      {content}
    </Link>
  );
}
