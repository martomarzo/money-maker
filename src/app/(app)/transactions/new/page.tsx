import { requireUserId } from "@/lib/session";
import { listAccounts, listCategories } from "@/lib/queries";
import { TransactionForm } from "@/components/transaction-form";
import { PageHeader } from "@/components/ui";

type Mode = "expense" | "income" | "transfer";

function parseMode(value: string | string[] | undefined): Mode | undefined {
  return value === "expense" || value === "income" || value === "transfer" ? value : undefined;
}

export default async function NewTransactionPage({
  searchParams,
}: PageProps<"/transactions/new">) {
  const userId = await requireUserId();
  const { type } = await searchParams;
  const defaultMode = parseMode(type);

  const [accounts, categories] = await Promise.all([
    listAccounts(userId),
    listCategories(userId),
  ]);

  const formAccounts = accounts
    .filter((a) => !a.archived)
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency.trim() }));

  const title =
    defaultMode === "income" ? "Add income" : defaultMode === "transfer" ? "New transfer" : "Add expense";

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6">
      <PageHeader title={title} />
      <TransactionForm accounts={formAccounts} categories={categories} defaultMode={defaultMode} />
    </div>
  );
}
