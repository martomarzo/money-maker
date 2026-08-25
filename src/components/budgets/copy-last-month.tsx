"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { copyBudgetsFromPreviousMonth } from "@/lib/actions/budgets";
import { Button, ErrorText } from "@/components/ui";

export function CopyLastMonth({ month }: { month: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await copyBudgetsFromPreviousMonth(month);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(`Copied ${result.copied ?? 0}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="secondary" size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? "Copying..." : "Copy last month"}
      </Button>
      {message && <span className="text-xs text-muted">{message}</span>}
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
