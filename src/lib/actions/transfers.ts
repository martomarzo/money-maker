"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { categories, transactions } from "@/db/schema";
import { centsToDecimalString, toCents } from "@/lib/domain/money";
import { getRate } from "@/lib/fx";
import { requireUser, requireUserId } from "@/lib/session";
import type { ActionResult } from "./auth";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

async function ownTransferLeg(userId: string, id: string) {
  const row = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
  });
  return row && row.type === "transfer" ? row : null;
}

function revalidate(id: string) {
  revalidatePath("/transactions");
  revalidatePath(`/transactions/${id}/edit`);
  revalidatePath("/accounts");
  revalidatePath("/");
}

const legSchema = z.object({
  id: z.uuid(),
  date: isoDate,
  payee: z.string().max(120).optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().max(1000).optional().or(z.literal("").transform(() => undefined)),
  categoryId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
});

/** Edit a transfer leg's descriptive fields. Date applies to both legs of a
 *  linked pair; payee/notes/category only to this leg. */
export async function updateTransferLeg(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = legSchema.safeParse({
    id: formData.get("id"),
    date: formData.get("date"),
    payee: formData.get("payee") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    categoryId: formData.get("categoryId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const leg = await ownTransferLeg(userId, parsed.data.id);
  if (!leg) return { ok: false, error: "Transfer not found" };
  if (parsed.data.categoryId) {
    const cat = await db.query.categories.findFirst({
      where: and(eq(categories.id, parsed.data.categoryId), eq(categories.userId, userId)),
    });
    if (!cat) return { ok: false, error: "Category not found" };
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({
        date: parsed.data.date,
        payee: parsed.data.payee ?? null,
        notes: parsed.data.notes ?? null,
        categoryId: parsed.data.categoryId ?? null,
        updatedAt: now,
      })
      .where(eq(transactions.id, leg.id));
    if (leg.transferPeerId && parsed.data.date !== leg.date) {
      await tx
        .update(transactions)
        .set({ date: parsed.data.date, updatedAt: now })
        .where(eq(transactions.id, leg.transferPeerId));
    }
  });
  revalidate(leg.id);
  return { ok: true };
}

/** Break the link between two transfer legs. Both stay as (unlinked)
 *  transfer legs so each can then be converted or re-linked. */
export async function unlinkTransfer(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const leg = await ownTransferLeg(userId, id);
  if (!leg) return { ok: false, error: "Transfer not found" };
  if (!leg.transferPeerId) return { ok: true };
  await db
    .update(transactions)
    .set({ transferPeerId: null, updatedAt: new Date() })
    .where(inArray(transactions.id, [leg.id, leg.transferPeerId]));
  revalidate(leg.id);
  return { ok: true };
}

/** Turn an UNLINKED transfer leg into an expense (outflow) or income
 *  (inflow). The sign of the leg decides the natural type; the caller may
 *  force the other one. Amount becomes positive; FX rate is snapshotted. */
export async function convertTransferLeg(
  id: string,
  type: "expense" | "income",
): Promise<ActionResult> {
  const { userId, baseCurrency } = await requireUser();
  const leg = await ownTransferLeg(userId, id);
  if (!leg) return { ok: false, error: "Transfer not found" };
  if (leg.transferPeerId) return { ok: false, error: "Unlink the transfer first" };

  const currency = leg.currency.trim();
  const cents = Math.abs(toCents(leg.amount, currency));
  if (cents === 0) return { ok: false, error: "Amount is zero" };
  const rate = leg.fxRateToBase ?? (await getRate(leg.date, currency, baseCurrency))?.toFixed(8) ?? null;

  await db
    .update(transactions)
    .set({ type, amount: centsToDecimalString(cents, currency), fxRateToBase: rate, updatedAt: new Date() })
    .where(eq(transactions.id, leg.id));
  revalidate(leg.id);
  return { ok: true };
}

/** Turn an expense/income back into an unlinked transfer leg (signed by
 *  direction). Useful when an import mis-typed a card payment. */
export async function convertToTransferLeg(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const row = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
  });
  if (!row) return { ok: false, error: "Transaction not found" };
  if (row.type === "transfer") return { ok: true };
  const currency = row.currency.trim();
  const cents = Math.abs(toCents(row.amount, currency)) * (row.type === "expense" ? -1 : 1);
  await db
    .update(transactions)
    .set({ type: "transfer", amount: centsToDecimalString(cents, currency), transferPeerId: null, updatedAt: new Date() })
    .where(eq(transactions.id, row.id));
  revalidate(row.id);
  return { ok: true };
}
