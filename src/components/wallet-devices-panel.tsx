"use client";

import { useActionState } from "react";
import {
  createWalletDevice,
  deleteWalletCardMapping,
  revokeWalletDevice,
  type CreateDeviceResult,
} from "@/lib/actions/wallet";

type Device = {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  revoked: boolean;
};
type Mapping = { id: string; cardKey: string; accountId: string; accountName: string };

// `<form action>` wants `(formData) => void | Promise<void>`, but the wallet
// actions return `ActionResult` for programmatic callers. Adapt with void
// wrappers rather than changing the actions' shared shape (same pattern as
// wallet-inbox.tsx, minus the "use server" directive — this file is already
// a client component, so these just call the imported server actions).
async function revokeDeviceAction(formData: FormData) {
  await revokeWalletDevice(formData);
}

async function deleteMappingAction(formData: FormData) {
  await deleteWalletCardMapping(formData);
}

export function WalletDevicesPanel({
  devices,
  mappings,
}: {
  devices: Device[];
  mappings: Mapping[];
}) {
  const [result, formAction, pending] = useActionState<CreateDeviceResult | null, FormData>(
    createWalletDevice,
    null,
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">
          Add device
        </h2>
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input
            name="name"
            placeholder="e.g. Martin's Pixel"
            required
            maxLength={60}
            className="rounded-lg border border-black/10 bg-transparent px-3 py-1.5 text-sm dark:border-white/15"
          />
          <button
            disabled={pending}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm font-medium transition hover:border-black/20 disabled:opacity-50 dark:border-white/15 dark:hover:border-white/30"
          >
            Create token
          </button>
        </form>
        {result && !result.ok && (
          <p className="text-sm text-red-600 dark:text-red-400">{result.error}</p>
        )}
        {result?.ok && result.token && (
          <div className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/15">
            <p className="font-medium">
              Token for “{result.deviceName}” — copy it now, it won&apos;t be shown again:
            </p>
            <code className="mt-1 block break-all rounded bg-black/5 p-2 text-xs dark:bg-white/10">
              {result.token}
            </code>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">
          Devices
        </h2>
        {devices.length === 0 && <p className="text-sm opacity-70">No devices yet.</p>}
        <ul className="flex flex-col gap-2">
          {devices.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/15"
            >
              <div>
                <span className="font-medium">{d.name}</span>
                <span className="ml-2 text-xs opacity-60">
                  added {d.createdAt}
                  {d.lastSeenAt ? ` · last seen ${d.lastSeenAt}` : " · never used"}
                </span>
              </div>
              {d.revoked ? (
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
                  revoked
                </span>
              ) : (
                <form action={revokeDeviceAction}>
                  <input type="hidden" name="id" value={d.id} />
                  <button className="text-xs text-red-600 underline-offset-2 hover:underline dark:text-red-400">
                    Revoke
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">
          Card mappings
        </h2>
        <p className="text-xs opacity-60">
          Created from the Wallet inbox (“remember card”). Delete one to
          re-teach it on the next capture.
        </p>
        {mappings.length === 0 && <p className="text-sm opacity-70">No mappings yet.</p>}
        <ul className="flex flex-col gap-2">
          {mappings.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/15"
            >
              <span>
                <code className="rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">
                  {m.cardKey}
                </code>{" "}
                → {m.accountName}
              </span>
              <form action={deleteMappingAction}>
                <input type="hidden" name="id" value={m.id} />
                <button className="text-xs text-red-600 underline-offset-2 hover:underline dark:text-red-400">
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
