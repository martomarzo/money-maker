import { requireMembership } from "@/lib/session";
import { listWalletCardMappings, listWalletDevices } from "@/lib/queries";
import { WalletDevicesPanel } from "@/components/wallet-devices-panel";

export default async function DevicesSettingsPage() {
  const { userId } = await requireMembership();
  const [devices, mappings] = await Promise.all([
    listWalletDevices(userId),
    listWalletCardMappings(userId),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Devices</h1>
        <p className="text-sm opacity-70">
          Phones that forward wallet payments. Each device gets a token —
          shown once — used as the Bearer header in its automation.
        </p>
      </div>
      <WalletDevicesPanel
        devices={devices.map((d) => ({
          id: d.id,
          name: d.name,
          createdAt: d.createdAt.toISOString().slice(0, 10),
          lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString().slice(0, 16).replace("T", " ") : null,
          revoked: d.revokedAt != null,
        }))}
        mappings={mappings}
      />
    </div>
  );
}
