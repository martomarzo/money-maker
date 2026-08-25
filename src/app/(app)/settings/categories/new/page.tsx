import { requireUserId } from "@/lib/session";
import { listCategories } from "@/lib/queries";
import { CategoryForm } from "@/components/category-form";
import { ButtonLink, PageHeader } from "@/components/ui";

export default async function NewCategoryPage({
  searchParams,
}: {
  searchParams: Promise<{ parentId?: string }>;
}) {
  const userId = await requireUserId();
  const { parentId } = await searchParams;
  const categories = await listCategories(userId);
  const parentOptions = categories
    .filter((c) => c.parentId === null)
    .map((c) => ({ id: c.id, name: c.name, icon: c.icon }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ButtonLink href="/settings/categories" variant="ghost" size="sm" className="self-start">
        ← Categories
      </ButtonLink>
      <PageHeader title="New category" />
      <div className="mx-auto w-full max-w-lg">
        <CategoryForm parentOptions={parentOptions} initialParentId={parentId} />
      </div>
    </div>
  );
}
