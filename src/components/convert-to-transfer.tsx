"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertToTransferLeg } from "@/lib/actions/transfers";
import { Button, ErrorText } from "@/components/ui";

/** "This is really a transfer" escape hatch on expense/income rows. */
export function ConvertToTransfer({ transactionId }: { transactionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm">
      <span className="text-muted">Actually a transfer between your accounts?</span>
      <Button type="button" variant="ghost" size="sm" disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await convertToTransferLeg(transactionId);
            if (!r.ok) setError(r.error);
            else router.refresh();
          })
        }>
        Mark as transfer
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
