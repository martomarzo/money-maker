"use server";

import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { households, invites, memberships, users } from "@/db/schema";
import { requireHouseholdMember, requireUserId } from "@/lib/session";
import type { ActionResult } from "./auth";

const CURRENCIES = ["EUR", "USD", "ARS", "PYG"] as const;

const householdSchema = z.object({
  name: z.string().min(1, "Give your household a name").max(80),
  baseCurrency: z.enum(CURRENCIES),
});

/** Create a household and make the caller its owner. Households own no
 *  ledger data — members share transactions into them (Phase 1.9). */
export async function createHousehold(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = householdSchema.safeParse({
    name: formData.get("name"),
    baseCurrency: formData.get("baseCurrency"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const householdId = await db.transaction(async (tx) => {
    const [household] = await tx
      .insert(households)
      .values({ name: parsed.data.name, baseCurrency: parsed.data.baseCurrency })
      .returning({ id: households.id });
    await tx.insert(memberships).values({ householdId: household.id, userId, role: "owner" });
    return household.id;
  });

  redirect(`/households/${householdId}`);
}

export async function updateHousehold(
  householdId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { role } = await requireHouseholdMember(householdId);
  if (role !== "owner") return { ok: false, error: "Only the owner can edit the household" };
  const parsed = householdSchema.safeParse({
    name: formData.get("name"),
    baseCurrency: formData.get("baseCurrency"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  await db
    .update(households)
    .set({ name: parsed.data.name, baseCurrency: parsed.data.baseCurrency })
    .where(eq(households.id, householdId));
  revalidatePath(`/households/${householdId}`);
  revalidatePath("/households");
  return { ok: true };
}

export async function createInvite(householdId: string): Promise<{ code: string }> {
  const { userId } = await requireHouseholdMember(householdId);
  const code = randomBytes(6).toString("base64url");
  await db.insert(invites).values({
    householdId,
    code,
    createdByUserId: userId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return { code };
}

export async function joinHousehold(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { ok: false, error: "Enter an invite code" };

  const invite = await db.query.invites.findFirst({
    where: and(eq(invites.code, code), isNull(invites.usedByUserId), gt(invites.expiresAt, new Date())),
  });
  if (!invite) return { ok: false, error: "Invite is invalid or expired" };

  const existing = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.householdId, invite.householdId)),
  });
  if (!existing) {
    await db.transaction(async (tx) => {
      await tx.insert(memberships).values({ householdId: invite.householdId, userId, role: "member" });
      await tx.update(invites).set({ usedByUserId: userId }).where(eq(invites.id, invite.id));
    });
  }

  redirect(`/households/${invite.householdId}`);
}

const settingsSchema = z.object({ baseCurrency: z.enum(CURRENCIES) });

/** Personal-ledger settings (currently just the base currency). */
export async function updatePersonalSettings(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = settingsSchema.safeParse({ baseCurrency: formData.get("baseCurrency") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  await db.update(users).set({ baseCurrency: parsed.data.baseCurrency }).where(eq(users.id, userId));
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  return { ok: true };
}
