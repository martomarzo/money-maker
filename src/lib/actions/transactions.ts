"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { centsToDecimalString, toCents } from "@/lib/domain/money";
import { getRate } from "@/lib/fx";
import { usablePostingAccount } from "@/lib/queries";
import { requireUser, requireUserId } from "@/lib/session";
import type { ActionResult } from "./auth";
import { categorizeAllMatching, renamePayeeEverywhere } from "./categorize";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

const entrySchema = z.object({
  type: z.enum(["expense", "income"]),
  accountId: z.uuid(),
  amount: z.string().min(1, "Enter an amount"),
  date: isoDate,
  categoryId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
  payee: z.string().max(120).optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().max(1000).optional().or(z.literal("").transform(() => undefined)),
});

const transferSchema = z.object({
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  amount: z.string().min(1, "Enter an amount"),
  toAmount: z.string().optional().or(z.literal("").transform(() => undefined)),
  date: isoDate,
  notes: z.string().max(1000).optional().or(z.literal("").transform(() => undefined)),
});

function parsePositiveAmount(raw: string, currency: string): number | null {
  try {
    const cents = toCents(raw, currency);
    return cents > 0 ? cents : null;
  } catch {
    return null;
  }
}

export async function createTransaction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { userId, baseCurrency } = await requireUser();
  const parsed = entrySchema.safeParse({
    type: formData.get("type"),
    accountId: formData.get("accountId"),
    amount: formData.get("amount"),
    date: formData.get("date"),
    categoryId: formData.get("categoryId") ?? undefined,
    payee: formData.get("payee") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const account = await usablePostingAccount(userId, parsed.data.accountId);
  if (!account) return { ok: false, error: "Account not found or not yours" };
  const currency = account.currency.trim();

  const cents = parsePositiveAmount(parsed.data.amount, currency);
  if (cents == null) return { ok: false, error: "Amount must be a positive number" };

  const rate = await getRate(parsed.data.date, currency, baseCurrency);

  await db.insert(transactions).values({
    id: randomUUID(),
    userId,
    accountId: account.id,
    createdByUserId: userId,
    type: parsed.data.type,
    amount: centsToDecimalString(cents, currency),
    currency,
    date: parsed.data.date,
    categoryId: parsed.data.categoryId,
    payee: parsed.data.payee,
    notes: parsed.data.notes,
    fxRateToBase: rate == null ? null : rate.toFixed(8),
  });

  revalidatePath("/transactions");
  revalidatePath("/accounts");
  return { ok: true };
}

export async function createTransfer(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = transferSchema.safeParse({
    fromAccountId: formData.get("fromAccountId"),
    toAccountId: formData.get("toAccountId"),
    amount: formData.get("amount"),
    toAmount: formData.get("toAmount") ?? undefined,
    date: formData.get("date"),
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (parsed.data.fromAccountId === parsed.data.toAccountId) {
    return { ok: false, error: "Pick two different accounts" };
  }

  const [from, to] = await Promise.all([
    usablePostingAccount(userId, parsed.data.fromAccountId),
    usablePostingAccount(userId, parsed.data.toAccountId),
  ]);
  if (!from || !to) return { ok: false, error: "Account not found or not yours" };
  const fromCurrency = from.currency.trim();
  const toCurrency = to.currency.trim();

  const fromCents = parsePositiveAmount(parsed.data.amount, fromCurrency);
  if (fromCents == null) return { ok: false, error: "Amount must be a positive number" };

  let toCentsValue: number | null;
  if (fromCurrency === toCurrency) {
    toCentsValue = parsed.data.toAmount
      ? parsePositiveAmount(parsed.data.toAmount, toCurrency)
      : fromCents;
  } else {
    if (!parsed.data.toAmount) {
      return {
        ok: false,
        error: `Enter the received amount in ${toCurrency} (cross-currency transfer)`,
      };
    }
    toCentsValue = parsePositiveAmount(parsed.data.toAmount, toCurrency);
  }
  if (toCentsValue == null) {
    return { ok: false, error: "Received amount must be a positive number" };
  }

  const outId = randomUUID();
  const inId = randomUUID();
  const shared = {
    userId,
    createdByUserId: userId,
    type: "transfer" as const,
    date: parsed.data.date,
    notes: parsed.data.notes,
  };

  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      ...shared,
      id: outId,
      accountId: from.id,
      amount: centsToDecimalString(-fromCents, fromCurrency),
      currency: fromCurrency,
      transferPeerId: inId,
    });
    await tx.insert(transactions).values({
      ...shared,
      id: inId,
      accountId: to.id,
      amount: centsToDecimalString(toCentsValue, toCurrency),
      currency: toCurrency,
      transferPeerId: outId,
    });
  });

  revalidatePath("/transactions");
  revalidatePath("/accounts");
  return { ok: true };
}

export async function updateTransaction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { userId, baseCurrency } = await requireUser();
  const id = String(formData.get("id") ?? "");

  const existing = await db.query.transactions.findFirst({
    where: and(
      eq(transactions.id, id),
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
    ),
  });
  if (!existing) return { ok: false, error: "Transaction not found" };
  if (existing.type === "transfer") {
    return { ok: false, error: "Delete and recreate transfers to change them" };
  }
  const account = await usablePostingAccount(userId, existing.accountId);
  if (!account) return { ok: false, error: "Not your transaction to edit" };

  const parsed = entrySchema.safeParse({
    type: formData.get("type") ?? existing.type,
    accountId: existing.accountId,
    amount: formData.get("amount"),
    date: formData.get("date"),
    categoryId: formData.get("categoryId") ?? undefined,
    payee: formData.get("payee") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const currency = existing.currency.trim();
  const cents = parsePositiveAmount(parsed.data.amount, currency);
  if (cents == null) return { ok: false, error: "Amount must be a positive number" };

  // Re-snapshot the rate if the date changed.
  let fxRateToBase = existing.fxRateToBase;
  if (parsed.data.date !== existing.date) {
    const rate = await getRate(parsed.data.date, currency, baseCurrency);
    fxRateToBase = rate == null ? null : rate.toFixed(8);
  }

  await db
    .update(transactions)
    .set({
      type: parsed.data.type,
      amount: centsToDecimalString(cents, currency),
      date: parsed.data.date,
      categoryId: parsed.data.categoryId ?? null,
      payee: parsed.data.payee ?? null,
      notes: parsed.data.notes ?? null,
      fxRateToBase,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, id));

  // Bulk options (edit form): apply the category to all rows with the old
  // payee (and remember it as a rule), and/or rename them all.
  const oldPayee = existing.payee?.trim();
  if (oldPayee) {
    if (formData.get("categorizeAll") && parsed.data.categoryId) {
      await categorizeAllMatching(oldPayee, parsed.data.categoryId, { overwrite: true });
    }
    if (formData.get("renameAll") && (parsed.data.payee ?? "") !== oldPayee) {
      await renamePayeeEverywhere(oldPayee, parsed.data.payee ?? "");
    }
  }

  revalidatePath("/transactions");
  revalidatePath("/accounts");
  return { ok: true };
}

export async function deleteTransaction(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const existing = await db.query.transactions.findFirst({
    where: and(
      eq(transactions.id, id),
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
    ),
  });
  if (!existing) return { ok: false, error: "Transaction not found" };
  const account = await usablePostingAccount(userId, existing.accountId);
  if (!account) return { ok: false, error: "Not your transaction to delete" };

  const now = new Date();
  await db
    .update(transactions)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      existing.transferPeerId
        ? or(eq(transactions.id, id), eq(transactions.id, existing.transferPeerId))
        : eq(transactions.id, id),
    );

  revalidatePath("/transactions");
  revalidatePath("/accounts");
  return { ok: true };
}
