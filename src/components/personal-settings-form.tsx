"use client";

import { useActionState } from "react";
import { updatePersonalSettings } from "@/lib/actions/household";
import { Button, ErrorText, labelClass, selectClass } from "@/components/ui";

const CURRENCIES = ["EUR", "USD", "ARS", "PYG"] as const;

export function PersonalSettingsForm({ baseCurrency }: { baseCurrency: string }) {
  const [state, formAction, pending] = useActionState(updatePersonalSettings, null);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="baseCurrency" className={labelClass}>
          Base currency
        </label>
        <select id="baseCurrency" name="baseCurrency" defaultValue={baseCurrency} className={selectClass}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted">Your personal reports convert everything to this currency.</p>
      </div>
      {state && !state.ok && <ErrorText>{state.error}</ErrorText>}
      {state && state.ok && <p className="text-sm text-income">Saved.</p>}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
