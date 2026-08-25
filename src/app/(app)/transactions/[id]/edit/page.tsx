import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireUserId } from "@/lib/session";
import {
  getShareForTransaction,
  listAccounts,
  listCategories,
  listHouseholds,
  ownTransaction,
} from "@/lib/queries";
import { toCents } from "@/lib/domain/money";
import { ShareSheet } from "@/components/share-sheet";
import { TransactionForm } from "@/components/transaction-form";
import { Card, CardTitle, PageHeader } from "@/components/ui";

export default async function EditTransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await requireUserId();

  const existing = await ownTransaction(userId, id);
  if (!existing) notFound();
  if (existing.type === "transfer") redirect("/transactions");

  const [account, userAccounts, categories, households, share] = await Promise.all([
    db.query.accounts.findFirst({ where: eq(accounts.id, existing.accountId) }),
    listAccounts(userId),
    listCategories(userId),
    listHouseholds(userId),
    getShareForTransaction(existing.id),
  ]);
  const shareHousehold = share ? households.find((h) => h.id === share.householdId) : null;

  const formAccounts = userAccounts
    .filter((a) => !a.archived)
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency.trim() }));

  const currency = existing.currency.trim();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Edit transaction" />
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <Card className="flex flex-col gap-3">
          <CardTitle>Household sharing</CardTitle>
          <ShareSheet
            transactionId={existing.id}
            amountCents={Math.abs(toCents(existing.amount, currency))}
            currency={currency}
            households={households.map((h) => ({ id: h.id, name: h.name }))}
            share={
              share
                ? {
                    householdId: share.householdId,
                    householdName: shareHousehold?.name ?? "Household",
                    splits: share.splits,
                  }
                : null
            }
            currentUserId={userId}
          />
        </Card>
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
            accountId: existing.accountId,
            accountName: account?.name ?? "",
            currency,
          }}
        />
      </div>
    </div>
  );
}
