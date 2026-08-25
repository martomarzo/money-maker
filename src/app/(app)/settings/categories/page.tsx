import Link from "next/link";
import { requireMembership } from "@/lib/session";
import {
  listCategories,
  listCategoryRules,
  listVisibleAccounts,
} from "@/lib/queries";
import { CategoryRulesPanel } from "@/components/category-rules-panel";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";

type Category = Awaited<ReturnType<typeof listCategories>>[number];

function CategoryLink({ category }: { category: Category }) {
  return (
    <Link href={`/settings/categories/${category.id}/edit`} className="block">
      <Card className="flex items-center justify-between gap-3 p-3 transition-colors hover:border-border-strong">
        <div className="flex items-center gap-2">
          <span>{category.icon ?? "❓"}</span>
          <span className="font-medium">{category.name}</span>
        </div>
        <Badge>{category.scope}</Badge>
      </Card>
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
      <PageHeader
        title="Categories"
        actions={<ButtonLink href="/settings/categories/new">New category</ButtonLink>}
      />

      {parents.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Create one to start organizing transactions."
          action={<ButtonLink href="/settings/categories/new">New category</ButtonLink>}
        />
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
                  className="ml-6 self-start text-xs text-muted hover:underline"
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
