"use client";

import { useActionState } from "react";
import { updateHousehold } from "@/lib/actions/household";
import { Button, ErrorText, inputClass, labelClass, selectClass } from "@/components/ui";

const CURRENCIES = ["EUR", "USD", "ARS", "PYG"] as const;

export function HouseholdSettingsForm({
  householdId,
  name,
  baseCurrency,
  canEdit,
}: {
  householdId: string;
  name: string;
  baseCurrency: string;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateHousehold.bind(null, householdId),
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className={labelClass}>
          Household name
        </label>
        <input id="name" name="name" type="text" required defaultValue={name} disabled={!canEdit} className={inputClass} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="baseCurrency" className={labelClass}>
          Base currency
        </label>
        <select id="baseCurrency" name="baseCurrency" defaultValue={baseCurrency} disabled={!canEdit} className={selectClass}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {state && !state.ok && <ErrorText>{state.error}</ErrorText>}
      {state && state.ok && <p className="text-sm text-income">Saved.</p>}
      {canEdit && (
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Saving..." : "Save"}
        </Button>
      )}
    </form>
  );
}
