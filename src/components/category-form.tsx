"use client";

import { useEffect, useState, useTransition } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { archiveCategory, createCategory, updateCategory } from "@/lib/actions/categories";

export interface CategoryFormCategory {
  id: string;
  name: string;
  icon: string | null;
  parentId: string | null;
  sortOrder: number;
}

interface ParentOption {
  id: string;
  name: string;
  icon: string | null;
}

const inputClass =
  "rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/30";

export function CategoryForm({
  category,
  parentOptions,
  initialParentId,
}: {
  category?: CategoryFormCategory;
  parentOptions: ParentOption[];
  initialParentId?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(category);
  const [state, formAction, pending] = useActionState(
    isEdit ? updateCategory : createCategory,
    null,
  );
  const [isArchivePending, startArchiveTransition] = useTransition();
  const [archiveError, setArchiveError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      router.push("/settings/categories");
      router.refresh();
    }
  }, [state, router]);

  function handleArchive() {
    if (!category) return;
    if (!confirm("Archive this category? Its subcategories will be archived too.")) return;
    setArchiveError(null);
    startArchiveTransition(async () => {
      const result = await archiveCategory(category.id);
      if (!result.ok) {
        setArchiveError(result.error);
      } else {
        router.push("/settings/categories");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        {category && <input type="hidden" name="id" value={category.id} />}
        {category && (
          <input type="hidden" name="sortOrder" value={category.sortOrder} />
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={category?.name}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="icon" className="text-sm font-medium">
            Icon <span className="text-black/40 dark:text-white/40">(optional emoji)</span>
          </label>
          <input
            id="icon"
            name="icon"
            type="text"
            maxLength={8}
            defaultValue={category?.icon ?? ""}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="parentId" className="text-sm font-medium">
            Parent category
          </label>
          <select
            id="parentId"
            name="parentId"
            defaultValue={category?.parentId ?? initialParentId ?? ""}
            className={inputClass}
          >
            <option value="">None (top-level)</option>
            {parentOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon ? `${p.icon} ` : ""}
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {state && !state.ok && (
          <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
        >
          {pending ? "Saving..." : isEdit ? "Save changes" : "Create category"}
        </button>
      </form>

      {category && (
        <div className="flex flex-col gap-2 border-t border-black/10 pt-4 dark:border-white/15">
          {archiveError && (
            <p className="text-sm text-red-600 dark:text-red-400">{archiveError}</p>
          )}
          <button
            type="button"
            onClick={handleArchive}
            disabled={isArchivePending}
            className="self-start rounded-md border border-red-600/40 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-60 dark:border-red-400/40 dark:text-red-400"
          >
            {isArchivePending ? "Archiving..." : "Archive category"}
          </button>
        </div>
      )}
    </div>
  );
}
