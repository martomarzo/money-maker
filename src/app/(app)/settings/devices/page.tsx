import { requireMembership } from "@/lib/session";
import { listWalletCardMappings, listWalletDevices } from "@/lib/queries";
import { WalletDevicesPanel } from "@/components/wallet-devices-panel";
import { PageHeader } from "@/components/ui";

export default async function DevicesSettingsPage() {
  const { userId } = await requireMembership();
  const [devices, mappings] = await Promise.all([
    listWalletDevices(userId),
    listWalletCardMappings(userId),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-8">
      <p className="text-xs text-muted">
        Experimental — notification capture depends on a third-party phone automation and is not
        the primary way to log expenses.
      </p>
      <PageHeader
        title="Devices"
        description="Phones that forward wallet payments. Each device gets a token — shown once — used as the Bearer header in its automation."
      />
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
