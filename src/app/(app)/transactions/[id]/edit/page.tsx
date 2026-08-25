import { notFound } from "next/navigation";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
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
import { TransferEditForm } from "@/components/transfer-edit-form";
import { ConvertToTransfer } from "@/components/convert-to-transfer";
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

  if (existing.type === "transfer") {
    const currency = existing.currency.trim();
    const [account, categories, peer] = await Promise.all([
      db.query.accounts.findFirst({ where: eq(accounts.id, existing.accountId) }),
      listCategories(userId),
      existing.transferPeerId
        ? db
            .select({ id: transactions.id, amount: transactions.amount, currency: transactions.currency, accountName: accounts.name })
            .from(transactions)
            .innerJoin(accounts, eq(accounts.id, transactions.accountId))
            .where(and(eq(transactions.id, existing.transferPeerId), isNull(transactions.deletedAt)))
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);
    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6">
        <PageHeader title="Edit transfer" />
        <TransferEditForm
          leg={{
            id: existing.id,
            amountCents: toCents(existing.amount, currency),
            currency,
            date: existing.date,
            payee: existing.payee,
            notes: existing.notes,
            categoryId: existing.categoryId,
            accountName: account?.name ?? "",
            peer: peer
              ? {
                  id: peer.id,
                  accountName: peer.accountName,
                  amountCents: toCents(peer.amount, peer.currency.trim()),
                  currency: peer.currency.trim(),
                }
              : null,
          }}
          categories={categories}
        />
      </div>
    );
  }

  const [account, userAccounts, categories, households, share] = await Promise.all([
    db.query.accounts.findFirst({ where: eq(accounts.id, existing.accountId) }),
    listAccounts(userId),
    listCategories(userId),
    listHouseholds(userId),
    getShareForTransaction(existing.id),
  ]);
  const shareHousehold = share ? households.find((h) => h.id === share.householdId) : null;

  let samePayeeCount = 0;
  if (existing.payee) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          eq(transactions.payee, existing.payee),
          ne(transactions.id, existing.id),
        ),
      );
    samePayeeCount = Number(count);
  }

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
        <ConvertToTransfer transactionId={existing.id} />
        <TransactionForm
          accounts={formAccounts}
          categories={categories}
          samePayeeCount={samePayeeCount}
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
