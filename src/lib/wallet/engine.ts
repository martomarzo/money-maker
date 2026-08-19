// Pure logic for wallet captures (Phase 1.7). No fs, no db — mirrors
// src/lib/import/engine.ts. Callers (the ingest route, server actions)
// own all I/O.

import { createHash } from "node:crypto";
import { decimalsFor, toCents } from "@/lib/domain/money";
import type { CapturePayload } from "./types";
import { suggestCategory, type CategoryRule, type TransactionDraft } from "@/lib/import/engine";

/** Idempotency key: same device + identical payload ⇒ same hash. Key order
 *  is canonicalized so a re-serialized retry still matches. */
export function captureHash(deviceId: string, payload: CapturePayload): string {
  const record = payload as unknown as Record<string, unknown>;
  const canonical = JSON.stringify(
    Object.keys(record)
      .sort()
      .map((k) => [k, record[k]]),
  );
  return createHash("sha256").update(`${deviceId}|${canonical}`).digest("hex");
}

/** Card keys are matched case-insensitively ("Revolut" ≡ "revolut"). */
export function normalizeCardKey(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Amount token → integer minor units of `currency`. Zero-decimal
 *  currencies (PYG) treat '.' and ',' purely as thousands separators:
 *  "₲ 25.000" is 25000, not 25.00. Throws on garbage. */
export function amountToMinor(amountRaw: string, currency: string): number {
  if (decimalsFor(currency) === 0) {
    const digits = amountRaw.replace(/[.,\s]/g, "");
    if (!/^\d+$/.test(digits)) throw new Error(`Invalid amount: ${amountRaw}`);
    const value = Number(digits);
    if (!Number.isSafeInteger(value)) throw new Error(`Amount overflow: ${amountRaw}`);
    return value;
  }
  return toCents(amountRaw, currency);
}

export interface ParsedPayment {
  amountRaw: string;
  currency: string | null;
  merchant: string | null;
  cardKey: string | null;
  date: string;
}

// "4,50" | "12.50" | "1.234,56" | "1,234.56" | "25.000" (thousands) …
const AMOUNT_SRC = String.raw`(\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;

// Order matters: multi-char tokens (US$) before the ambiguous bare $.
const CURRENCY_TOKENS: ReadonlyArray<readonly [string, string | null]> = [
  [String.raw`US\$|U\$S|USD`, "USD"],
  [String.raw`EUR|€`, "EUR"],
  [String.raw`ARS`, "ARS"],
  [String.raw`PYG|Gs\.?|₲`, "PYG"],
  [String.raw`\$`, null], // bare $ — resolved to the account's currency later
];

/** First currency-adjacent amount in `s` (symbol/code before or after). */
export function findAmount(
  s: string,
): { amountRaw: string; currency: string | null } | null {
  for (const [tok, code] of CURRENCY_TOKENS) {
    const re = new RegExp(
      `(?:${tok})\\s?${AMOUNT_SRC}|${AMOUNT_SRC}\\s?(?:${tok})`,
      "iu",
    );
    const m = re.exec(s);
    if (m) return { amountRaw: (m[1] ?? m[2])!, currency: code };
  }
  return null;
}

const LAST4 = /(?:[•*xX]{2,}\s*|\bending(?:\s+in)?\s+|\bterminad[ao]\s+en\s+)(\d{4})\b/u;

function extractMerchant(title: string, text: string): string | null {
  // "at Amazon with Mastercard…" / "en Superseis." — sentence form first.
  const at = /\b(?:at|en)\s+(.{2,80}?)(?:\s+(?:with|con)\b|[.\n]|$)/iu.exec(
    `${title}\n${text}`,
  );
  if (at) return at[1].trim();
  // Otherwise: whichever line is NOT the amount line is the merchant
  // (classic Google Wallet: title = amount+card, text = merchant).
  for (const line of [text, title]) {
    const cleaned = line.trim();
    if (cleaned && !findAmount(cleaned)) return cleaned;
  }
  return null;
}

export function parseAndroidNotification(
  title: string,
  text: string,
  postedAt: string,
): ParsedPayment | null {
  const combined = `${title}\n${text}`;
  const found = findAmount(combined);
  if (!found) return null;
  const last4 = LAST4.exec(combined);
  return {
    amountRaw: found.amountRaw,
    currency: found.currency,
    merchant: extractMerchant(title, text),
    cardKey: last4 ? last4[1] : null,
    date: postedAt.slice(0, 10),
  };
}

export function parseIosTransaction(p: {
  merchant: string;
  amount: string;
  currency?: string;
  cardName: string;
  postedAt: string;
}): ParsedPayment | null {
  const trimmedAmount = p.amount.trim();
  const found =
    findAmount(trimmedAmount) ??
    (/^[\d.,\s]+$/.test(trimmedAmount)
      ? { amountRaw: trimmedAmount, currency: null }
      : null);
  if (!found) return null;
  const explicit = p.currency?.trim().toUpperCase();
  return {
    amountRaw: found.amountRaw,
    currency: explicit && /^[A-Z]{3}$/.test(explicit) ? explicit : found.currency,
    merchant: p.merchant.trim() || null,
    cardKey: p.cardName.trim() ? normalizeCardKey(p.cardName) : null,
    date: p.postedAt.slice(0, 10),
  };
}

export function parseCapture(payload: CapturePayload): ParsedPayment | null {
  return payload.kind === "android_notification"
    ? parseAndroidNotification(payload.title, payload.text, payload.postedAt)
    : parseIosTransaction(payload);
}

/** category_rules suggestion for a captured merchant — same matcher the
 *  import preview uses (case/accent-insensitive substring, priority wins). */
export function suggestCategoryForMerchant(
  merchant: string | null,
  currency: string,
  accountId: string,
  rules: CategoryRule[],
): string | null {
  if (!merchant) return null;
  const draft: TransactionDraft = {
    index: 0,
    date: "",
    type: "expense",
    amountCents: 0,
    currency,
    payee: merchant,
    notes: null,
    originalAmountCents: null,
    originalCurrency: null,
    sourceHash: null,
    kind: "purchase",
  };
  return suggestCategory(draft, rules, accountId);
}
