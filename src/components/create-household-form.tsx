"use client";

import { useActionState } from "react";
import { createHousehold } from "@/lib/actions/household";
import { Button, ErrorText, inputClass, labelClass, selectClass } from "@/components/ui";

const CURRENCIES = ["EUR", "USD", "ARS", "PYG"] as const;

export function CreateHouseholdForm() {
  const [state, formAction, pending] = useActionState(createHousehold, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className={labelClass}>
          Household name
        </label>
        <input id="name" name="name" type="text" required className={inputClass} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="baseCurrency" className={labelClass}>
          Base currency
        </label>
        <select
          id="baseCurrency"
          name="baseCurrency"
          defaultValue="EUR"
          className={selectClass}
        >
          {CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </div>

      {state && !state.ok && <ErrorText>{state.error}</ErrorText>}

      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? "Creating..." : "Create household"}
      </Button>
    </form>
  );
}
