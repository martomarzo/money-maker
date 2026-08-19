import {
  assignWalletCaptureAccount,
  dismissWalletCapture,
  recategorizeWalletCapture,
  shareWalletCapture,
} from "@/lib/actions/wallet";
import { formatCents } from "@/lib/domain/money";
import type { listWalletCaptures } from "@/lib/queries";

type CaptureRow = Awaited<ReturnType<typeof listWalletCaptures>>[number];

// `<form action>` wants `(formData) => void | Promise<void>`, but the wallet
// actions return `ActionResult` for programmatic callers. Adapt with void
// server-action wrappers rather than changing the actions' shared shape.
async function shareAction(formData: FormData) {
  "use server";
  await shareWalletCapture(formData);
}

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
      <p className="rounded-lg border border-black/10 p-6 text-sm opacity-70 dark:border-white/15">
        Nothing captured yet. Set up a device in Settings → Devices, then make
        a card payment.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {captures.map((row) => (
        <li
          key={row.id}
          className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 text-sm dark:border-white/15"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {row.merchant ?? rawSummary(row)}
              </span>
              {amountLabel(row) && (
                <span className="opacity-70">{amountLabel(row)}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
                {STATUS_LABEL[row.status]}
              </span>
              {row.status === "booked" && row.txnVisibility && (
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
                  {row.txnVisibility}
                </span>
              )}
            </div>
          </div>
          <p className="text-xs opacity-60">
            {row.deviceName}
            {row.cardKey ? ` · card ${row.cardKey}` : ""} ·{" "}
            {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
          </p>

          {row.status === "booked" && (
            <div className="flex flex-wrap items-end gap-3">
              {row.txnVisibility === "personal" && (
                <form action={shareAction}>
                  <input type="hidden" name="captureId" value={row.id} />
                  <button className="rounded-lg border border-black/10 px-3 py-1.5 font-medium transition hover:border-black/20 dark:border-white/15 dark:hover:border-white/30">
                    Mark shared
                  </button>
                </form>
              )}
              <form action={recategorizeAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="captureId" value={row.id} />
                <select
                  name="categoryId"
                  defaultValue={row.txnCategoryId ?? ""}
                  className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 dark:border-white/15"
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
                  <label className="flex items-center gap-1 text-xs opacity-80">
                    <input type="checkbox" name="always" />
                    always for “{row.merchant}”
                  </label>
                )}
                <button className="rounded-lg border border-black/10 px-3 py-1.5 font-medium transition hover:border-black/20 dark:border-white/15 dark:hover:border-white/30">
                  Set category
                </button>
              </form>
            </div>
          )}

          {row.status === "needs_account" && (
            <form action={assignAccountAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="captureId" value={row.id} />
              <select
                name="accountId"
                defaultValue=""
                className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 dark:border-white/15"
              >
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
                <label className="flex items-center gap-1 text-xs opacity-80">
                  <input type="checkbox" name="remember" defaultChecked />
                  remember card {row.cardKey}
                </label>
              )}
              <button className="rounded-lg border border-black/10 px-3 py-1.5 font-medium transition hover:border-black/20 dark:border-white/15 dark:hover:border-white/30">
                Book expense
              </button>
            </form>
          )}

          {row.status !== "booked" && row.status !== "dismissed" && (
            <form action={dismissAction}>
              <input type="hidden" name="captureId" value={row.id} />
              <button className="text-xs opacity-60 underline-offset-2 hover:underline">
                Dismiss
              </button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
