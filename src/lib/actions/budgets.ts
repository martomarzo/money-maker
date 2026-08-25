"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { budgets, categories } from "@/db/schema";
import { centsToDecimalString, toCents } from "@/lib/domain/money";
import { isMonth, monthBounds, shiftMonth } from "@/lib/reports";
import { requireUser } from "@/lib/session";
import type { ActionResult } from "./auth";

const upsertSchema = z.object({
  categoryId: z.uuid(),
  month: z.string().refine(isMonth, "Invalid month"),
  amount: z.string(),
});

/** Set (or clear, when amount is empty/zero) the budget for a category+month
 *  in the user's base currency. */
export async function upsertBudget(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { userId, baseCurrency } = await requireUser();
  const parsed = upsertSchema.safeParse({
    categoryId: formData.get("categoryId"),
    month: formData.get("month"),
    amount: formData.get("amount") ?? "",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const category = await db.query.categories.findFirst({
    where: and(eq(categories.id, parsed.data.categoryId), eq(categories.userId, userId)),
  });
  if (!category) return { ok: false, error: "Category not found" };

  const monthDate = monthBounds(parsed.data.month).from;
  let cents: number;
  try {
    cents = parsed.data.amount.trim() === "" ? 0 : toCents(parsed.data.amount, baseCurrency);
  } catch {
    return { ok: false, error: "Enter a valid amount" };
  }
  if (cents < 0) return { ok: false, error: "Budget can't be negative" };

  const existing = await db.query.budgets.findFirst({
    where: and(
      eq(budgets.userId, userId),
      eq(budgets.categoryId, category.id),
      eq(budgets.month, monthDate),
    ),
  });

  if (cents === 0) {
    if (existing && !existing.deletedAt) {
      await db
        .update(budgets)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(budgets.id, existing.id));
    }
  } else if (existing) {
    await db
      .update(budgets)
      .set({
        amount: centsToDecimalString(cents, baseCurrency),
        currency: baseCurrency,
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(budgets.id, existing.id));
  } else {
    await db.insert(budgets).values({
      userId,
      categoryId: category.id,
      month: monthDate,
      amount: centsToDecimalString(cents, baseCurrency),
      currency: baseCurrency,
    });
  }

  revalidatePath("/budgets");
  revalidatePath("/");
  return { ok: true };
}

/** Copy the previous month's budgets into `month` for categories that have
 *  none yet. Returns how many were created. */
export async function copyBudgetsFromPreviousMonth(
  month: string,
): Promise<ActionResult & { copied?: number }> {
  const { userId } = await requireUser();
  if (!isMonth(month)) return { ok: false, error: "Invalid month" };
  const target = monthBounds(month).from;
  const source = monthBounds(shiftMonth(month, -1)).from;

  const [sourceRows, targetRows] = await Promise.all([
    db.query.budgets.findMany({
      where: and(eq(budgets.userId, userId), eq(budgets.month, source), isNull(budgets.deletedAt)),
    }),
    db.query.budgets.findMany({
      where: and(eq(budgets.userId, userId), eq(budgets.month, target)),
    }),
  ]);
  const targetByCat = new Map(targetRows.map((b) => [b.categoryId, b]));

  let copied = 0;
  await db.transaction(async (tx) => {
    for (const s of sourceRows) {
      const t = targetByCat.get(s.categoryId);
      if (t && !t.deletedAt) continue;
      if (t) {
        await tx
          .update(budgets)
          .set({ amount: s.amount, currency: s.currency, deletedAt: null, updatedAt: new Date() })
          .where(eq(budgets.id, t.id));
      } else {
        await tx.insert(budgets).values({
          userId,
          categoryId: s.categoryId,
          month: target,
          amount: s.amount,
          currency: s.currency,
        });
      }
      copied++;
    }
  });

  revalidatePath("/budgets");
  return { ok: true, copied };
}
