"use client";

import { useState, useTransition } from "react";
import { createInvite } from "@/lib/actions/household";
import { Button, ErrorText } from "@/components/ui";

export function InvitePartner({ householdId }: { householdId: string }) {
  const [isPending, startTransition] = useTransition();
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleInvite() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      try {
        const { code } = await createInvite(householdId);
        setJoinUrl(`${window.location.origin}/join/${code}`);
      } catch {
        setError("Could not create an invite. Try again.");
      }
    });
  }

  async function handleCopy() {
    if (!joinUrl) return;
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <Button type="button" onClick={handleInvite} disabled={isPending} className="self-start">
        {isPending ? "Creating invite..." : "Create invite link"}
      </Button>

      {error && <ErrorText>{error}</ErrorText>}

      {joinUrl && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted p-3 sm:flex-row sm:items-center">
          <input
            type="text"
            readOnly
            value={joinUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-muted outline-none focus:border-accent focus:ring-2 focus:ring-ring"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            className="shrink-0"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
    </div>
  );
}
