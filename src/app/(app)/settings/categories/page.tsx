import Link from "next/link";
import { requireMembership } from "@/lib/session";
import {
  listCategories,
  listCategoryRules,
  listVisibleAccounts,
} from "@/lib/queries";
import { CategoryRulesPanel } from "@/components/category-rules-panel";

type Category = Awaited<ReturnType<typeof listCategories>>[number];

function CategoryLink({ category }: { category: Category }) {
  return (
    <Link
      href={`/settings/categories/${category.id}/edit`}
      className="flex items-center justify-between gap-3 rounded-lg border border-black/10 p-3 text-sm transition hover:border-black/20 dark:border-white/15 dark:hover:border-white/30"
    >
      <div className="flex items-center gap-2">
        <span>{category.icon ?? "❓"}</span>
        <span className="font-medium">{category.name}</span>
      </div>
      <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
        {category.scope}
      </span>
    </Link>
  );
}

export default async function CategoriesSettingsPage() {
  const { userId, householdId } = await requireMembership();
  const [categories, rules, accounts] = await Promise.all([
    listCategories(householdId),
    listCategoryRules(householdId),
    listVisibleAccounts(householdId, userId),
  ]);

  const parents = categories.filter((c) => c.parentId === null);
  const childrenByParent = new Map<string, Category[]>();
  for (const c of categories) {
    if (c.parentId) {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }
  }

  const formAccounts = accounts
    .filter((a) => !a.archived)
    .map((a) => ({ id: a.id, name: a.name }));
  const categoryOptions = categories.map((c) => ({
    id: c.id,
    parentId: c.parentId,
    name: c.name,
    icon: c.icon,
  }));

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Categories</h1>
        <Link
          href="/settings/categories/new"
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          New category
        </Link>
      </div>

      {parents.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">
          No categories yet. Create one to start organizing transactions.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {parents.map((parent) => {
            const children = childrenByParent.get(parent.id) ?? [];
            return (
              <div key={parent.id} className="flex flex-col gap-2">
                <CategoryLink category={parent} />
                {children.length > 0 && (
                  <div className="ml-6 flex flex-col gap-2">
                    {children.map((child) => (
                      <CategoryLink key={child.id} category={child} />
                    ))}
                  </div>
                )}
                <Link
                  href={`/settings/categories/new?parentId=${parent.id}`}
                  className="ml-6 self-start text-xs text-black/50 hover:underline dark:text-white/50"
                >
                  + Add subcategory
                </Link>
              </div>
            );
          })}
        </div>
      )}

      <CategoryRulesPanel rules={rules} categories={categoryOptions} accounts={formAccounts} />
    </div>
  );
}
