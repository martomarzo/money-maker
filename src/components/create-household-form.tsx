"use client";

import { useActionState } from "react";
import { createHousehold } from "@/lib/actions/household";

const CURRENCIES = ["EUR", "USD", "ARS", "PYG"] as const;

export function CreateHouseholdForm() {
  const [state, formAction, pending] = useActionState(createHousehold, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium">
          Household name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/30"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="baseCurrency" className="text-sm font-medium">
          Base currency
        </label>
        <select
          id="baseCurrency"
          name="baseCurrency"
          defaultValue="EUR"
          className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/30"
        >
          {CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </div>

      {state && !state.ok && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
      >
        {pending ? "Creating..." : "Create household"}
      </button>
    </form>
  );
}
