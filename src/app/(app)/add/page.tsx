import { requireUserId } from "@/lib/session";
import { listAccounts, listCategories } from "@/lib/queries";
import { QuickAdd } from "@/components/quick-add";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Add expense" };

export default async function QuickAddPage() {
  const userId = await requireUserId();
  const [accounts, categories] = await Promise.all([listAccounts(userId), listCategories(userId)]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5">
      <PageHeader title="Add expense" />
      <QuickAdd
        accounts={accounts
          .filter((a) => !a.archived)
          .map((a) => ({ id: a.id, name: a.name, currency: a.currency.trim() }))}
        categories={categories.map((c) => ({
          id: c.id,
          parentId: c.parentId,
          name: c.name,
          icon: c.icon,
        }))}
      />
    </div>
  );
}
