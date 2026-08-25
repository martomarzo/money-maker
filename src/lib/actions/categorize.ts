"use server";

import { and, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { categories, categoryRules, transactions } from "@/db/schema";
import { requireUserId } from "@/lib/session";
import type { ActionResult } from "./auth";

async function ownCategory(userId: string, categoryId: string) {
  return db.query.categories.findFirst({
    where: and(
      eq(categories.id, categoryId),
      eq(categories.userId, userId),
      isNull(categories.deletedAt),
    ),
  });
}

function revalidate() {
  revalidatePath("/transactions");
  revalidatePath("/");
  revalidatePath("/budgets");
}

/** Set (or clear) one transaction's category. */
export async function setTransactionCategory(
  transactionId: string,
  categoryId: string | null,
): Promise<ActionResult> {
  const userId = await requireUserId();
  if (categoryId && !(await ownCategory(userId, categoryId))) {
    return { ok: false, error: "Category not found" };
  }
  const result = await db
    .update(transactions)
    .set({ categoryId, updatedAt: new Date() })
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
      ),
    )
    .returning({ id: transactions.id });
  if (result.length === 0) return { ok: false, error: "Transaction not found" };
  revalidate();
  return { ok: true };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Create an "always categorize <matchText> as <category>" rule and apply it
 *  now to every transaction whose payee or notes contain the text. By default
 *  only uncategorized rows are touched; `overwrite` recategorizes all matches.
 *  Returns how many rows changed. */
export async function categorizeAllMatching(
  matchText: string,
  categoryId: string,
  options: { createRule?: boolean; overwrite?: boolean } = {},
): Promise<ActionResult & { applied?: number }> {
  const userId = await requireUserId();
  const text = matchText.trim();
  if (text.length < 2) return { ok: false, error: "Match text is too short" };
  if (!(await ownCategory(userId, categoryId))) return { ok: false, error: "Category not found" };

  const pattern = `%${escapeLike(text)}%`;
  const matches = or(ilike(transactions.payee, pattern), ilike(transactions.notes, pattern));

  const changed = await db.transaction(async (tx) => {
    if (options.createRule !== false) {
      const existing = await tx.query.categoryRules.findFirst({
        where: and(
          eq(categoryRules.userId, userId),
          isNull(categoryRules.deletedAt),
          sql`lower(${categoryRules.matchText}) = lower(${text})`,
          isNull(categoryRules.accountId),
          isNull(categoryRules.currency),
        ),
      });
      if (existing) {
        if (existing.categoryId !== categoryId) {
          await tx
            .update(categoryRules)
            .set({ categoryId, updatedAt: new Date() })
            .where(eq(categoryRules.id, existing.id));
        }
      } else {
        await tx.insert(categoryRules).values({ userId, matchText: text, categoryId, priority: 50 });
      }
    }
    const rows = await tx
      .update(transactions)
      .set({ categoryId, updatedAt: new Date() })
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          ne(transactions.type, "transfer"),
          matches,
          options.overwrite
            ? or(isNull(transactions.categoryId), ne(transactions.categoryId, categoryId))
            : isNull(transactions.categoryId),
        ),
      )
      .returning({ id: transactions.id });
    return rows.length;
  });

  revalidate();
  revalidatePath("/settings/categories");
  return { ok: true, applied: changed };
}

/** Rename the payee on every one of the user's transactions that currently
 *  has exactly `fromPayee`. Returns how many changed. */
export async function renamePayeeEverywhere(
  fromPayee: string,
  toPayee: string,
): Promise<ActionResult & { renamed?: number }> {
  const userId = await requireUserId();
  const from = fromPayee.trim();
  const to = toPayee.trim();
  if (!from) return { ok: false, error: "Nothing to rename" };
  const rows = await db
    .update(transactions)
    .set({ payee: to || null, updatedAt: new Date() })
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        eq(transactions.payee, from),
      ),
    )
    .returning({ id: transactions.id });
  revalidate();
  return { ok: true, renamed: rows.length };
}
