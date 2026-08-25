"use client";

import { useEffect, useState, useTransition } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { archiveCategory, createCategory, updateCategory } from "@/lib/actions/categories";
import { Button, ErrorText, inputClass, labelClass, selectClass } from "@/components/ui";

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
          <label htmlFor="name" className={labelClass}>
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
          <label htmlFor="icon" className={labelClass}>
            Icon <span className="text-faint">(optional emoji)</span>
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
          <label htmlFor="parentId" className={labelClass}>
            Parent category
          </label>
          <select
            id="parentId"
            name="parentId"
            defaultValue={category?.parentId ?? initialParentId ?? ""}
            className={selectClass}
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

        {state && !state.ok && <ErrorText>{state.error}</ErrorText>}

        <Button type="submit" disabled={pending} className="mt-2">
          {pending ? "Saving..." : isEdit ? "Save changes" : "Create category"}
        </Button>
      </form>

      {category && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {archiveError && <ErrorText>{archiveError}</ErrorText>}
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={handleArchive}
            disabled={isArchivePending}
            className="self-start"
          >
            {isArchivePending ? "Archiving..." : "Archive category"}
          </Button>
        </div>
      )}
    </div>
  );
}
