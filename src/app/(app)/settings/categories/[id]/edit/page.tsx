import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { requireMembership } from "@/lib/session";
import { listCategories } from "@/lib/queries";
import { CategoryForm } from "@/components/category-form";

export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { householdId } = await requireMembership();
  const { id } = await params;

  const category = await db.query.categories.findFirst({
    where: and(
      eq(categories.id, id),
      eq(categories.householdId, householdId),
      isNull(categories.deletedAt),
    ),
  });
  if (!category) notFound();

  const allCategories = await listCategories(householdId);
  const parentOptions = allCategories
    .filter((c) => c.parentId === null && c.id !== category.id)
    .map((c) => ({ id: c.id, name: c.name, icon: c.icon }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href="/settings/categories"
        className="self-start text-sm text-black/60 hover:underline dark:text-white/60"
      >
        ← Categories
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">Edit category</h1>
      <div className="max-w-sm">
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
