import type { db } from "@/db";
import { DEFAULT_CATEGORIES } from "./default-categories";
import { DEFAULT_CATEGORY_RULES } from "./default-category-rules";
import { categories, categoryRules } from "./schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Seed the default category tree + merchant rules into a user's personal
 *  ledger. Called once at registration. */
export async function seedPersonalLedger(tx: Tx, userId: string): Promise<void> {
  const categoryIdByName = new Map<string, string>();
  for (const [i, parent] of DEFAULT_CATEGORIES.entries()) {
    const [parentRow] = await tx
      .insert(categories)
      .values({ userId, name: parent.name, icon: parent.icon, sortOrder: i })
      .returning();
    categoryIdByName.set(parentRow.name, parentRow.id);
    if (parent.children?.length) {
      const childRows = await tx
        .insert(categories)
        .values(
          parent.children.map((child, j) => ({
            userId,
            parentId: parentRow.id,
            name: child.name,
            icon: child.icon,
            sortOrder: j,
          })),
        )
        .returning();
      for (const childRow of childRows) categoryIdByName.set(childRow.name, childRow.id);
    }
  }

  const ruleRows = DEFAULT_CATEGORY_RULES.flatMap((rule) => {
    const categoryId = categoryIdByName.get(rule.categoryName);
    return categoryId ? [{ userId, matchText: rule.matchText, categoryId, priority: 100 }] : [];
  });
  if (ruleRows.length > 0) await tx.insert(categoryRules).values(ruleRows);
}
