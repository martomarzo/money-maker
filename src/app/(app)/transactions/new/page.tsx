import { requireMembership } from "@/lib/session";
import { listCategories, listVisibleAccounts } from "@/lib/queries";
import { TransactionForm } from "@/components/transaction-form";

export default async function NewTransactionPage() {
  const { userId, householdId } = await requireMembership();

  const [accounts, categories] = await Promise.all([
    listVisibleAccounts(householdId, userId),
    listCategories(householdId),
  ]);

  const formAccounts = accounts
    .filter((a) => !a.archived)
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency.trim() }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight">Add transaction</h1>
      <TransactionForm accounts={formAccounts} categories={categories} />
    </div>
  );
}
