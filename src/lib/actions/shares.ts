"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { memberships, transactionShareSplits, transactionShares } from "@/db/schema";
import { toCents } from "@/lib/domain/money";
import { evenSplit, validateSplit, type SplitLine } from "@/lib/domain/split";
import { getShareForTransaction, listMembers, ownTransaction } from "@/lib/queries";
import { requireUserId } from "@/lib/session";
import type { ActionResult } from "./auth";

/** Member ids of a household the user belongs to, or null. */
async function membershipMembers(userId: string, householdId: string) {
  const mine = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.householdId, householdId)),
  });
  if (!mine) return null;
  return (await listMembers(householdId)).map((m) => m.id);
}

/** Share one of the user's transactions with a household (full amount, even
 *  split among current members). Re-sharing to a different household moves
 *  the share; the split is recomputed. */
export async function shareTransaction(
  transactionId: string,
  householdId: string,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const [txn, memberIds] = await Promise.all([
    ownTransaction(userId, transactionId),
    membershipMembers(userId, householdId),
  ]);
  if (!txn) return { ok: false, error: "Transaction not found" };
  if (!memberIds) return { ok: false, error: "You are not a member of that household" };

  const totalCents = Math.abs(toCents(txn.amount, txn.currency.trim()));
  const lines = evenSplit(totalCents, txn.currency.trim(), memberIds, userId);

  await db.transaction(async (tx) => {
    // Soft-delete any existing share (unique index is on transaction_id, so
    // hard-delete stale rows to make room; soft-deleted shares are not needed
    // for sync of this write-through model).
    await tx.delete(transactionShares).where(eq(transactionShares.transactionId, transactionId));
    const [share] = await tx
      .insert(transactionShares)
      .values({ transactionId, householdId, sharedByUserId: userId })
      .returning({ id: transactionShares.id });
    await tx.insert(transactionShareSplits).values(
      lines.map((l) => ({ shareId: share.id, userId: l.userId, shareCents: l.shareCents })),
    );
  });

  revalidatePath("/transactions");
  revalidatePath(`/transactions/${transactionId}/edit`);
  revalidatePath(`/households/${householdId}`);
  revalidatePath("/");
  return { ok: true };
}

export async function unshareTransaction(transactionId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const txn = await ownTransaction(userId, transactionId);
  if (!txn) return { ok: false, error: "Transaction not found" };
  const share = await getShareForTransaction(transactionId);
  if (!share) return { ok: true };

  await db.delete(transactionShares).where(eq(transactionShares.id, share.id));

  revalidatePath("/transactions");
  revalidatePath(`/transactions/${transactionId}/edit`);
  revalidatePath(`/households/${share.householdId}`);
  revalidatePath("/");
  return { ok: true };
}

const splitSchema = z.array(
  z.object({ userId: z.uuid(), shareCents: z.number().int().nonnegative() }),
);

/** Replace the split on a shared transaction. Lines must cover exactly the
 *  members already in the split and sum to the transaction amount. */
export async function updateSplit(
  transactionId: string,
  rawLines: SplitLine[],
): Promise<ActionResult> {
  const userId = await requireUserId();
  const txn = await ownTransaction(userId, transactionId);
  if (!txn) return { ok: false, error: "Transaction not found" };
  const share = await getShareForTransaction(transactionId);
  if (!share) return { ok: false, error: "Transaction is not shared" };

  const parsed = splitSchema.safeParse(rawLines);
  if (!parsed.success) return { ok: false, error: "Invalid split" };
  const lines = parsed.data;

  const totalCents = Math.abs(toCents(txn.amount, txn.currency.trim()));
  const valid = validateSplit(totalCents, lines);
  if (!valid.ok) return valid;

  const allowed = new Set(share.splits.map((s) => s.userId));
  if (lines.length !== allowed.size || lines.some((l) => !allowed.has(l.userId))) {
    return { ok: false, error: "Split must cover exactly the shared members" };
  }

  await db.transaction(async (tx) => {
    for (const line of lines) {
      await tx
        .update(transactionShareSplits)
        .set({ shareCents: line.shareCents })
        .where(
          and(
            eq(transactionShareSplits.shareId, share.id),
            eq(transactionShareSplits.userId, line.userId),
          ),
        );
    }
    await tx
      .update(transactionShares)
      .set({ updatedAt: new Date() })
      .where(eq(transactionShares.id, share.id));
  });

  revalidatePath(`/transactions/${transactionId}/edit`);
  revalidatePath(`/households/${share.householdId}`);
  return { ok: true };
}
