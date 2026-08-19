"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  categories,
  categoryRules,
  households,
  transactions,
  walletCaptures,
  walletCardMappings,
  walletDevices,
} from "@/db/schema";
import type { CategoryRule } from "@/lib/import/engine";
import { listCategoryRules, usablePostingAccount } from "@/lib/queries";
import { requireMembership } from "@/lib/session";
import { bookCapture } from "@/lib/wallet/book";
import { generateDeviceToken, hashDeviceToken } from "@/lib/wallet/tokens";
import type { ActionResult } from "./auth";

export type CreateDeviceResult = {
  ok: boolean;
  error?: string;
  token?: string;
  deviceName?: string;
};

/** Capture owned by this user (via its device), or null. */
async function ownCapture(userId: string, captureId: string) {
  const rows = await db
    .select({ capture: walletCaptures, deviceUserId: walletDevices.userId })
    .from(walletCaptures)
    .innerJoin(walletDevices, eq(walletCaptures.deviceId, walletDevices.id))
    .where(eq(walletCaptures.id, captureId))
    .limit(1);
  const row = rows[0];
  return row && row.deviceUserId === userId ? row.capture : null;
}

export async function createWalletDevice(
  _prev: CreateDeviceResult | null,
  formData: FormData,
): Promise<CreateDeviceResult> {
  const { userId } = await requireMembership();
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 60) {
    return { ok: false, error: "Give the device a name (max 60 chars)" };
  }
  const token = generateDeviceToken();
  await db.insert(walletDevices).values({
    userId,
    name,
    tokenHash: hashDeviceToken(token),
  });
  revalidatePath("/settings/devices");
  // Plaintext token is returned exactly once and never stored.
  return { ok: true, token, deviceName: name };
}

export async function revokeWalletDevice(formData: FormData): Promise<ActionResult> {
  const { userId } = await requireMembership();
  const id = String(formData.get("id") ?? "");
  await db
    .update(walletDevices)
    .set({ revokedAt: new Date() })
    .where(and(eq(walletDevices.id, id), eq(walletDevices.userId, userId)));
  revalidatePath("/settings/devices");
  return { ok: true };
}

export async function deleteWalletCardMapping(formData: FormData): Promise<ActionResult> {
  const { userId } = await requireMembership();
  const id = String(formData.get("id") ?? "");
  await db
    .delete(walletCardMappings)
    .where(and(eq(walletCardMappings.id, id), eq(walletCardMappings.userId, userId)));
  revalidatePath("/settings/devices");
  return { ok: true };
}

export async function shareWalletCapture(formData: FormData): Promise<ActionResult> {
  const { userId, householdId } = await requireMembership();
  const capture = await ownCapture(userId, String(formData.get("captureId") ?? ""));
  if (!capture?.transactionId) return { ok: false, error: "Capture not booked" };
  await db
    .update(transactions)
    .set({ visibility: "shared", updatedAt: new Date() })
    .where(
      and(
        eq(transactions.id, capture.transactionId),
        eq(transactions.householdId, householdId),
      ),
    );
  revalidatePath("/wallet");
  revalidatePath("/transactions");
  return { ok: true };
}

const recategorizeSchema = z.object({
  captureId: z.uuid(),
  categoryId: z.uuid(),
});

export async function recategorizeWalletCapture(formData: FormData): Promise<ActionResult> {
  const { userId, householdId } = await requireMembership();
  const parsed = recategorizeSchema.safeParse({
    captureId: formData.get("captureId"),
    categoryId: formData.get("categoryId"),
  });
  if (!parsed.success) return { ok: false, error: "Pick a category" };
  const alwaysRule = formData.get("always") === "on";

  const capture = await ownCapture(userId, parsed.data.captureId);
  if (!capture?.transactionId) return { ok: false, error: "Capture not booked" };
  const category = await db.query.categories.findFirst({
    where: and(
      eq(categories.id, parsed.data.categoryId),
      eq(categories.householdId, householdId),
    ),
  });
  if (!category) return { ok: false, error: "Category not found" };

  await db
    .update(transactions)
    .set({ categoryId: category.id, updatedAt: new Date() })
    .where(
      and(
        eq(transactions.id, capture.transactionId),
        eq(transactions.householdId, householdId),
      ),
    );
  if (alwaysRule && capture.merchant) {
    await db.insert(categoryRules).values({
      householdId,
      matchText: capture.merchant,
      categoryId: category.id,
    });
  }
  revalidatePath("/wallet");
  revalidatePath("/transactions");
  return { ok: true };
}

const assignSchema = z.object({
  captureId: z.uuid(),
  accountId: z.uuid(),
});

export async function assignWalletCaptureAccount(formData: FormData): Promise<ActionResult> {
  const { userId, householdId } = await requireMembership();
  const parsed = assignSchema.safeParse({
    captureId: formData.get("captureId"),
    accountId: formData.get("accountId"),
  });
  if (!parsed.success) return { ok: false, error: "Pick an account" };
  const remember = formData.get("remember") === "on";

  const capture = await ownCapture(userId, parsed.data.captureId);
  if (!capture) return { ok: false, error: "Capture not found" };
  if (capture.status !== "needs_account") {
    return { ok: false, error: "Capture is not waiting for an account" };
  }
  const account = await usablePostingAccount(householdId, userId, parsed.data.accountId);
  if (!account) return { ok: false, error: "Account not found or not yours" };

  const [household, ruleRows] = await Promise.all([
    db.query.households.findFirst({ where: eq(households.id, householdId) }),
    listCategoryRules(householdId),
  ]);
  const rules: CategoryRule[] = ruleRows.map((r) => r.rule);
  const txnId = await bookCapture({
    capture: { id: capture.id, raw: capture.raw },
    account: { id: account.id, currency: account.currency },
    householdId,
    userId,
    baseCurrency: household!.baseCurrency,
    rules,
  });
  if (!txnId) {
    return { ok: false, error: "Could not turn this capture into a transaction" };
  }
  if (remember && capture.cardKey) {
    await db
      .insert(walletCardMappings)
      .values({ userId, cardKey: capture.cardKey, accountId: account.id })
      .onConflictDoUpdate({
        target: [walletCardMappings.userId, walletCardMappings.cardKey],
        set: { accountId: account.id },
      });
  }
  revalidatePath("/wallet");
  revalidatePath("/transactions");
  revalidatePath("/settings/devices");
  return { ok: true };
}

export async function dismissWalletCapture(formData: FormData): Promise<ActionResult> {
  const { userId } = await requireMembership();
  const capture = await ownCapture(userId, String(formData.get("captureId") ?? ""));
  if (!capture) return { ok: false, error: "Capture not found" };
  if (capture.status === "booked") {
    return { ok: false, error: "Already booked — delete the transaction instead" };
  }
  await db
    .update(walletCaptures)
    .set({ status: "dismissed" })
    .where(eq(walletCaptures.id, capture.id));
  revalidatePath("/wallet");
  return { ok: true };
}
