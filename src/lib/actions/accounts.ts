"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { centsToDecimalString, toCents } from "@/lib/domain/money";
import { requireUserId } from "@/lib/session";
import type { ActionResult } from "./auth";

const accountSchema = z.object({
  name: z.string().min(1, "Give the account a name").max(80),
  type: z.enum(["checking", "savings", "cash", "credit_card"]),
  currency: z.enum(["EUR", "USD", "ARS", "PYG"]),
  country: z
    .string()
    .length(2, "Country must be a 2-letter code")
    .toUpperCase()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  initialBalance: z.string().default("0"),
});

function parseAccountForm(formData: FormData) {
  return accountSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    currency: formData.get("currency"),
    country: formData.get("country") ?? undefined,
    initialBalance: formData.get("initialBalance") || "0",
  });
}

export async function createAccount(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = parseAccountForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  let initialBalance: string;
  try {
    initialBalance = centsToDecimalString(
      toCents(parsed.data.initialBalance, parsed.data.currency),
      parsed.data.currency,
    );
  } catch {
    return { ok: false, error: "Invalid initial balance" };
  }

  await db.insert(accounts).values({
    userId,
    name: parsed.data.name,
    type: parsed.data.type,
    currency: parsed.data.currency,
    country: parsed.data.country,
    initialBalance,
  });

  revalidatePath("/accounts");
  return { ok: true };
}

export async function updateAccount(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  const parsed = parseAccountForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const existing = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, id), eq(accounts.userId, userId)),
  });
  if (!existing) return { ok: false, error: "Account not found" };

  let initialBalance: string;
  try {
    // Currency is immutable after creation (plan §5) — parse with existing currency.
    initialBalance = centsToDecimalString(
      toCents(parsed.data.initialBalance, existing.currency.trim()),
      existing.currency.trim(),
    );
  } catch {
    return { ok: false, error: "Invalid initial balance" };
  }

  await db
    .update(accounts)
    .set({
      name: parsed.data.name,
      type: parsed.data.type,
      country: parsed.data.country,
      initialBalance,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, id));

  revalidatePath("/accounts");
  return { ok: true };
}

export async function setAccountArchived(
  id: string,
  archived: boolean,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const existing = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, id), eq(accounts.userId, userId)),
  });
  if (!existing) return { ok: false, error: "Account not found" };

  await db
    .update(accounts)
    .set({ archived, updatedAt: new Date() })
    .where(eq(accounts.id, id));

  revalidatePath("/accounts");
  return { ok: true };
}
