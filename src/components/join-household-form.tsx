"use client";

import { useActionState } from "react";
import { joinHousehold } from "@/lib/actions/household";
import { Button, ErrorText, inputClass, labelClass } from "@/components/ui";

export function JoinHouseholdForm({ defaultCode }: { defaultCode?: string }) {
  const [state, formAction, pending] = useActionState(joinHousehold, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="code" className={labelClass}>
          Invite code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          required
          defaultValue={defaultCode}
          readOnly={Boolean(defaultCode)}
          className={inputClass}
        />
      </div>

      {state && !state.ok && <ErrorText>{state.error}</ErrorText>}

      <Button type="submit" variant="secondary" disabled={pending} className="mt-2 w-full">
        {pending ? "Joining..." : "Join household"}
      </Button>
    </form>
  );
}
