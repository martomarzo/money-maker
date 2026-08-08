import Link from "next/link";
import { requireMembership } from "@/lib/session";
import { listCategories } from "@/lib/queries";
import { CategoryForm } from "@/components/category-form";

export default async function NewCategoryPage({
  searchParams,
}: {
  searchParams: Promise<{ parentId?: string }>;
}) {
  const { householdId } = await requireMembership();
  const { parentId } = await searchParams;
  const categories = await listCategories(householdId);
  const parentOptions = categories
    .filter((c) => c.parentId === null)
    .map((c) => ({ id: c.id, name: c.name, icon: c.icon }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href="/settings/categories"
        className="self-start text-sm text-black/60 hover:underline dark:text-white/60"
      >
        ← Categories
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">New category</h1>
      <div className="max-w-sm">
        <CategoryForm parentOptions={parentOptions} initialParentId={parentId} />
      </div>
    </div>
  );
}
