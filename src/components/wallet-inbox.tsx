import {
  assignWalletCaptureAccount,
  dismissWalletCapture,
  recategorizeWalletCapture,
} from "@/lib/actions/wallet";
import { formatCents } from "@/lib/domain/money";
import type { listWalletCaptures } from "@/lib/queries";
import { Badge, Button, EmptyState, selectClass } from "@/components/ui";

type CaptureRow = Awaited<ReturnType<typeof listWalletCaptures>>[number];

// `<form action>` wants `(formData) => void | Promise<void>`, but the wallet
// actions return `ActionResult` for programmatic callers. Adapt with void
// server-action wrappers rather than changing the actions' shared shape.
async function recategorizeAction(formData: FormData) {
  "use server";
  await recategorizeWalletCapture(formData);
}

async function assignAccountAction(formData: FormData) {
  "use server";
  await assignWalletCaptureAccount(formData);
}

async function dismissAction(formData: FormData) {
  "use server";
  await dismissWalletCapture(formData);
}

const STATUS_LABEL: Record<CaptureRow["status"], string> = {
  booked: "Booked",
  needs_account: "Needs account",
  unparsed: "Unparsed",
  dismissed: "Dismissed",
};

/** Raw-payload fallback line for rows the parser couldn't handle. */
function rawSummary(row: CaptureRow): string {
  const raw = row.raw as Record<string, unknown>;
  if (row.kind === "android_notification") {
    return [raw.title, raw.text].filter(Boolean).join(" — ").slice(0, 140);
  }
  return [raw.merchant, raw.amount].filter(Boolean).join(" — ").slice(0, 140);
}

function amountLabel(row: CaptureRow): string | null {
  if (row.txnAmount && row.txnCurrency) {
    return `${row.txnAmount} ${row.txnCurrency.trim()}`;
  }
  if (row.amountMinor != null && row.currency) {
    return formatCents(row.amountMinor, row.currency.trim());
  }
  return null;
}

export function WalletInbox({
  captures,
  accounts,
  categories,
}: {
  captures: CaptureRow[];
  accounts: Array<{ id: string; name: string; currency: string }>;
  categories: Array<{ id: string; name: string; icon: string | null }>;
}) {
  if (captures.length === 0) {
    return (
      <EmptyState
        title="Nothing captured yet"
        description="Set up a device in Settings → Devices, then make a card payment."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {captures.map((row) => (
        <li
          key={row.id}
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">{row.merchant ?? rawSummary(row)}</span>
              {amountLabel(row) && <span className="tnum text-muted">{amountLabel(row)}</span>}
            </div>
            <div className="flex items-center gap-2">
              <Badge>{STATUS_LABEL[row.status]}</Badge>
            </div>
          </div>
          <p className="text-xs text-faint">
            {row.deviceName}
            {row.cardKey ? ` · card ${row.cardKey}` : ""} ·{" "}
            {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
          </p>

          {row.status === "booked" && (
            <div className="flex flex-wrap items-end gap-3">
              <form action={recategorizeAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="captureId" value={row.id} />
                <select
                  name="categoryId"
                  defaultValue={row.txnCategoryId ?? ""}
                  className={`${selectClass} w-auto`}
                >
                  <option value="" disabled>
                    Category…
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon ? `${c.icon} ` : ""}
                      {c.name}
                    </option>
                  ))}
                </select>
                {row.merchant && (
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input type="checkbox" name="always" />
                    always for &ldquo;{row.merchant}&rdquo;
                  </label>
                )}
                <Button type="submit" variant="secondary" size="sm">
                  Set category
                </Button>
              </form>
            </div>
          )}

          {row.status === "needs_account" && (
            <form action={assignAccountAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="captureId" value={row.id} />
              <select name="accountId" defaultValue="" className={`${selectClass} w-auto`}>
                <option value="" disabled>
                  Account…
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency.trim()})
                  </option>
                ))}
              </select>
              {row.cardKey && (
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input type="checkbox" name="remember" defaultChecked />
                  remember card {row.cardKey}
                </label>
              )}
              <Button type="submit" variant="secondary" size="sm">
                Book expense
              </Button>
            </form>
          )}

          {row.status !== "booked" && row.status !== "dismissed" && (
            <form action={dismissAction}>
              <input type="hidden" name="captureId" value={row.id} />
              <button
                type="submit"
                className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
              >
                Dismiss
              </button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
