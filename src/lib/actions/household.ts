"use server";

import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { DEFAULT_CATEGORIES } from "@/db/default-categories";
import { categories, households, invites, memberships } from "@/db/schema";
import { requireUserId } from "@/lib/session";
import type { ActionResult } from "./auth";

const CURRENCIES = ["EUR", "USD", "ARS", "PYG"] as const;

const createHouseholdSchema = z.object({
  name: z.string().min(1, "Give your household a name").max(80),
  baseCurrency: z.enum(CURRENCIES),
});

export async function createHousehold(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = createHouseholdSchema.safeParse({
    name: formData.get("name"),
    baseCurrency: formData.get("baseCurrency"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  await db.transaction(async (tx) => {
    const [household] = await tx
      .insert(households)
      .values({ name: parsed.data.name, baseCurrency: parsed.data.baseCurrency })
      .returning();

    await tx.insert(memberships).values({
      householdId: household.id,
      userId,
      role: "owner",
    });

    for (const [i, parent] of DEFAULT_CATEGORIES.entries()) {
      const [parentRow] = await tx
        .insert(categories)
        .values({
          householdId: household.id,
          name: parent.name,
          icon: parent.icon,
          sortOrder: i,
        })
        .returning();
      if (parent.children?.length) {
        await tx.insert(categories).values(
          parent.children.map((child, j) => ({
            householdId: household.id,
            parentId: parentRow.id,
            name: child.name,
            icon: child.icon,
            sortOrder: j,
          })),
        );
      }
    }
  });

  redirect("/");
}

export async function createInvite(): Promise<{ code: string }> {
  const userId = await requireUserId();
  const membership = await db.query.memberships.findFirst({
    where: eq(memberships.userId, userId),
  });
  if (!membership) redirect("/onboarding");

  const code = randomBytes(6).toString("base64url");
  await db.insert(invites).values({
    householdId: membership.householdId,
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
    where: and(
      eq(invites.code, code),
      isNull(invites.usedByUserId),
      gt(invites.expiresAt, new Date()),
    ),
  });
  if (!invite) return { ok: false, error: "Invite is invalid or expired" };

  const existing = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.householdId, invite.householdId),
    ),
  });
  if (!existing) {
    await db.transaction(async (tx) => {
      await tx.insert(memberships).values({
        householdId: invite.householdId,
        userId,
        role: "member",
      });
      await tx
        .update(invites)
        .set({ usedByUserId: userId })
        .where(eq(invites.id, invite.id));
    });
  }

  redirect("/");
}
