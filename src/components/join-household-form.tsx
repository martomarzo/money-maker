"use client";

import { useActionState } from "react";
import { joinHousehold } from "@/lib/actions/household";

export function JoinHouseholdForm({ defaultCode }: { defaultCode?: string }) {
  const [state, formAction, pending] = useActionState(joinHousehold, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="code" className="text-sm font-medium">
          Invite code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          required
          defaultValue={defaultCode}
          readOnly={Boolean(defaultCode)}
          className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/30"
        />
      </div>

      {state && !state.ok && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md border border-black/10 px-4 py-2 text-sm font-medium disabled:opacity-60 dark:border-white/15"
      >
        {pending ? "Joining..." : "Join household"}
      </button>
    </form>
  );
}
