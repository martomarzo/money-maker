// Books a stored wallet capture as an expense transaction. Server-side only
// (db + fx I/O). Shared by the ingest route (auto-book on arrival) and the
// assign-account server action (booking a held `needs_account` capture).

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { transactions, walletCaptures } from "@/db/schema";
import { centsToDecimalString, convertCents } from "@/lib/domain/money";
import { getRate } from "@/lib/fx";
import type { CategoryRule } from "@/lib/import/engine";
import {
  amountToMinor,
  parseCapture,
  suggestCategoryForMerchant,
} from "./engine";
import { capturePayloadSchema } from "./types";

export interface BookCaptureInput {
  capture: { id: string; raw: unknown };
  account: { id: string; currency: string };
  householdId: string;
  userId: string;
  baseCurrency: string;
  rules: CategoryRule[];
}

/** Parse the capture's raw payload and insert the expense + mark the capture
 *  booked (one db transaction). Returns the transaction id, or null when the
 *  payload can't be parsed, the amount isn't positive, or a needed FX rate
 *  is missing — callers leave the capture in its current status then. */
export async function bookCapture(input: BookCaptureInput): Promise<string | null> {
  const payload = capturePayloadSchema.safeParse(input.capture.raw);
  if (!payload.success) return null;
  const parsed = parseCapture(payload.data);
  if (!parsed) return null;

  const accountCurrency = input.account.currency.trim();
  const tapCurrency = parsed.currency ?? accountCurrency;

  let tapCents: number;
  try {
    tapCents = amountToMinor(parsed.amountRaw, tapCurrency);
  } catch {
    return null;
  }
  if (tapCents <= 0) return null;

  let accountCents = tapCents;
  let originalAmount: string | null = null;
  let originalCurrency: string | null = null;
  if (tapCurrency !== accountCurrency) {
    const rate = await getRate(parsed.date, tapCurrency, accountCurrency);
    if (rate == null) return null;
    accountCents = convertCents(tapCents, rate, tapCurrency, accountCurrency);
    if (accountCents <= 0) return null;
    originalAmount = centsToDecimalString(tapCents, tapCurrency);
    originalCurrency = tapCurrency;
  }

  const baseRate = await getRate(
    parsed.date,
    accountCurrency,
    input.baseCurrency.trim(),
  );
  const categoryId = suggestCategoryForMerchant(
    parsed.merchant,
    accountCurrency,
    input.account.id,
    input.rules,
  );

  const txnId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      id: txnId,
      householdId: input.householdId,
      accountId: input.account.id,
      createdByUserId: input.userId,
      type: "expense",
      amount: centsToDecimalString(accountCents, accountCurrency),
      currency: accountCurrency,
      date: parsed.date,
      categoryId,
      payee: parsed.merchant,
      visibility: "personal",
      fxRateToBase: baseRate == null ? null : baseRate.toFixed(8),
      originalAmount,
      originalCurrency,
    });
    await tx
      .update(walletCaptures)
      .set({ status: "booked", transactionId: txnId })
      .where(eq(walletCaptures.id, input.capture.id));
  });
  return txnId;
}
