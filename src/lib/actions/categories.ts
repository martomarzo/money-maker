"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { accounts, categories, categoryRules } from "@/db/schema";
import { requireMembership } from "@/lib/session";
import type { ActionResult } from "./auth";

const categorySchema = z.object({
  name: z.string().min(1, "Give the category a name").max(80),
  icon: z.string().max(16).optional().or(z.literal("").transform(() => undefined)),
  parentId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
});

const updateCategorySchema = categorySchema.extend({
  sortOrder: z.coerce.number().int().optional(),
});

const ruleSchema = z.object({
  matchText: z
    .string()
    .min(2, "Match text must be at least 2 characters")
    .max(80, "Match text must be at most 80 characters"),
  categoryId: z.uuid("Pick a category"),
  accountId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
  currency: z
    .string()
    .length(3, "Currency must be a 3-letter code")
    .toUpperCase()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  priority: z.coerce.number().int().default(0),
});

/** Validates a proposed parentId: must be a non-deleted top-level category in
 *  the household. When editing an existing category (`excludeCategoryId`),
 *  also rejects self-parenting and re-parenting a category that already has
 *  children (would create two levels of nesting). */
async function validateParent(
  householdId: string,
  parentId: string,
  excludeCategoryId?: string,
): Promise<string | null> {
  if (excludeCategoryId && parentId === excludeCategoryId) {
    return "A category cannot be its own parent";
  }

  const parent = await db.query.categories.findFirst({
    where: and(
      eq(categories.id, parentId),
      eq(categories.householdId, householdId),
      isNull(categories.deletedAt),
    ),
  });
  if (!parent) return "Parent category not found";
  if (parent.parentId !== null) {
    return "Only one level of subcategories is allowed";
  }

  if (excludeCategoryId) {
    const child = await db.query.categories.findFirst({
      where: and(
        eq(categories.parentId, excludeCategoryId),
        isNull(categories.deletedAt),
      ),
    });
    if (child) {
      return "This category has subcategories and cannot be nested under another category";
    }
  }

  return null;
}

export async function createCategory(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { householdId } = await requireMembership();
  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    icon: formData.get("icon") ?? undefined,
    parentId: formData.get("parentId") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  if (parsed.data.parentId) {
    const error = await validateParent(householdId, parsed.data.parentId);
    if (error) return { ok: false, error };
  }

  await db.insert(categories).values({
    householdId,
    parentId: parsed.data.parentId ?? null,
    name: parsed.data.name,
    icon: parsed.data.icon ?? null,
  });

  revalidatePath("/settings/categories");
  return { ok: true };
}

export async function updateCategory(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { householdId } = await requireMembership();
  const id = String(formData.get("id") ?? "");
  const parsed = updateCategorySchema.safeParse({
    name: formData.get("name"),
    icon: formData.get("icon") ?? undefined,
    parentId: formData.get("parentId") ?? undefined,
    sortOrder: formData.get("sortOrder") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const existing = await db.query.categories.findFirst({
    where: and(
      eq(categories.id, id),
      eq(categories.householdId, householdId),
      isNull(categories.deletedAt),
    ),
  });
  if (!existing) return { ok: false, error: "Category not found" };

  if (parsed.data.parentId) {
    const error = await validateParent(householdId, parsed.data.parentId, id);
    if (error) return { ok: false, error };
  }

  await db
    .update(categories)
    .set({
      name: parsed.data.name,
      icon: parsed.data.icon ?? null,
      parentId: parsed.data.parentId ?? null,
      sortOrder: parsed.data.sortOrder ?? existing.sortOrder,
      updatedAt: new Date(),
    })
    .where(eq(categories.id, id));

  revalidatePath("/settings/categories");
  return { ok: true };
}

/** Soft-deletes the category and, since only one level of nesting exists,
 *  any children it has. Transactions keep their categoryId — that's fine,
 *  archived categories just stop showing up for new entries. */
export async function archiveCategory(id: string): Promise<ActionResult> {
  const { householdId } = await requireMembership();
  const existing = await db.query.categories.findFirst({
    where: and(
      eq(categories.id, id),
      eq(categories.householdId, householdId),
      isNull(categories.deletedAt),
    ),
  });
  if (!existing) return { ok: false, error: "Category not found" };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(categories)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(categories.id, id));
    await tx
      .update(categories)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(categories.parentId, id), isNull(categories.deletedAt)));
  });

  revalidatePath("/settings/categories");
  return { ok: true };
}

export async function createCategoryRule(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { householdId } = await requireMembership();
  const parsed = ruleSchema.safeParse({
    matchText: formData.get("matchText"),
    categoryId: formData.get("categoryId"),
    accountId: formData.get("accountId") ?? undefined,
    currency: formData.get("currency") ?? undefined,
    priority: formData.get("priority") || "0",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const category = await db.query.categories.findFirst({
    where: and(
      eq(categories.id, parsed.data.categoryId),
      eq(categories.householdId, householdId),
      isNull(categories.deletedAt),
    ),
  });
  if (!category) return { ok: false, error: "Category not found" };

  if (parsed.data.accountId) {
    const account = await db.query.accounts.findFirst({
      where: and(
        eq(accounts.id, parsed.data.accountId),
        eq(accounts.householdId, householdId),
        isNull(accounts.deletedAt),
      ),
    });
    if (!account) return { ok: false, error: "Account not found" };
  }

  await db.insert(categoryRules).values({
    householdId,
    matchText: parsed.data.matchText,
    accountId: parsed.data.accountId ?? null,
    currency: parsed.data.currency ?? null,
    categoryId: parsed.data.categoryId,
    priority: parsed.data.priority,
  });

  revalidatePath("/settings/categories");
  return { ok: true };
}

export async function deleteCategoryRule(id: string): Promise<ActionResult> {
  const { householdId } = await requireMembership();
  const existing = await db.query.categoryRules.findFirst({
    where: and(
      eq(categoryRules.id, id),
      eq(categoryRules.householdId, householdId),
      isNull(categoryRules.deletedAt),
    ),
  });
  if (!existing) return { ok: false, error: "Rule not found" };

  const now = new Date();
  await db
    .update(categoryRules)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(categoryRules.id, id));

  revalidatePath("/settings/categories");
  return { ok: true };
}
