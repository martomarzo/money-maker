import { requireMembership } from "@/lib/session";
import {
  listCategories,
  listVisibleAccounts,
  listWalletCaptures,
} from "@/lib/queries";
import { WalletInbox } from "@/components/wallet-inbox";
import { PageHeader } from "@/components/ui";

export default async function WalletPage() {
  const { userId, householdId } = await requireMembership();
  const [captures, accounts, categories] = await Promise.all([
    listWalletCaptures(userId),
    listVisibleAccounts(householdId, userId),
    listCategories(householdId),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <p className="text-xs text-muted">
        Experimental — notification capture depends on a third-party phone automation and is not
        the primary way to log expenses.
      </p>
      <PageHeader
        title="Wallet captures"
        description="Payments forwarded from your phone. Booked ones are already in your transactions — fix up the rest here."
      />
      <WalletInbox
        captures={captures}
        accounts={accounts
          .filter((a) => !a.archived)
          .map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon }))}
      />
    </div>
  );
}
