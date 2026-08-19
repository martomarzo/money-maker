// Pure logic for wallet captures (Phase 1.7). No fs, no db — mirrors
// src/lib/import/engine.ts. Callers (the ingest route, server actions)
// own all I/O.

import { createHash } from "node:crypto";
import { decimalsFor, toCents } from "@/lib/domain/money";
import type { CapturePayload } from "./types";

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
