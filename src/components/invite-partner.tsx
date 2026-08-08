"use client";

import { useState, useTransition } from "react";
import { createInvite } from "@/lib/actions/household";

export function InvitePartner() {
  const [isPending, startTransition] = useTransition();
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleInvite() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      try {
        const { code } = await createInvite();
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
      <button
        type="button"
        onClick={handleInvite}
        disabled={isPending}
        className="self-start rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
      >
        {isPending ? "Creating invite..." : "Invite partner"}
      </button>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {joinUrl && (
        <div className="flex flex-col gap-2 rounded-md border border-black/10 p-3 text-sm dark:border-white/15">
          <code className="break-all text-black/80 dark:text-white/80">{joinUrl}</code>
          <button
            type="button"
            onClick={handleCopy}
            className="self-start rounded-md border border-black/10 px-3 py-1.5 text-xs font-medium dark:border-white/15"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}
