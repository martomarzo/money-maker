import { notFound, redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { requireMembership } from "@/lib/session";
import { listCategories, listVisibleAccounts } from "@/lib/queries";
import { TransactionForm } from "@/components/transaction-form";

export default async function EditTransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId, householdId } = await requireMembership();

  const existing = await db.query.transactions.findFirst({
    where: and(
      eq(transactions.id, id),
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
    ),
  });
  if (!existing) notFound();
  if (existing.type === "transfer") redirect("/transactions");

  const [account, visibleAccounts, categories] = await Promise.all([
    db.query.accounts.findFirst({ where: eq(accounts.id, existing.accountId) }),
    listVisibleAccounts(householdId, userId),
    listCategories(householdId),
  ]);

  const formAccounts = visibleAccounts
    .filter((a) => !a.archived)
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency.trim() }));

  const currency = existing.currency.trim();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight">Edit transaction</h1>
      <TransactionForm
        accounts={formAccounts}
        categories={categories}
        transaction={{
          id: existing.id,
          type: existing.type,
          amount: existing.amount,
          date: existing.date,
          categoryId: existing.categoryId,
          payee: existing.payee,
          notes: existing.notes,
          visibility: existing.visibility,
          accountId: existing.accountId,
          accountName: account?.name ?? "",
          currency,
        }}
      />
    </div>
  );
}
