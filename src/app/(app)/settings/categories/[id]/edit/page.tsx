import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { requireUserId } from "@/lib/session";
import { listCategories } from "@/lib/queries";
import { CategoryForm } from "@/components/category-form";
import { ButtonLink, PageHeader } from "@/components/ui";

export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;

  const category = await db.query.categories.findFirst({
    where: and(
      eq(categories.id, id),
      eq(categories.userId, userId),
      isNull(categories.deletedAt),
    ),
  });
  if (!category) notFound();

  const allCategories = await listCategories(userId);
  const parentOptions = allCategories
    .filter((c) => c.parentId === null && c.id !== category.id)
    .map((c) => ({ id: c.id, name: c.name, icon: c.icon }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ButtonLink href="/settings/categories" variant="ghost" size="sm" className="self-start">
        ← Categories
      </ButtonLink>
      <PageHeader title="Edit category" />
      <div className="mx-auto w-full max-w-lg">
        <CategoryForm
          category={{
            id: category.id,
            name: category.name,
            icon: category.icon,
            parentId: category.parentId,
            sortOrder: category.sortOrder,
          }}
          parentOptions={parentOptions}
        />
      </div>
    </div>
  );
}
