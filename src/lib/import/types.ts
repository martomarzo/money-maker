// Types + zod schema for the extracted-statement JSON contract produced by
// the standalone Python pipeline in scripts/extract/ (see
// scripts/extract/README.md). Files live at data/imports/extracted/*.json
// (gitignored, real financial data) and are the input to the import engine.
//
// Kept intentionally tolerant: `meta` and `row.extra` are source-specific
// bags of extra fields (passthrough), and `account_hint.currency` is null
// for statements that mix currencies (Santander account + Visa yield both
// ARS and USD rows from one file — one app account per currency present).

import { z } from "zod";

export const IMPORT_ROW_KINDS = [
  "purchase",
  "payment",
  "fee",
  "exchange",
  "transfer",
  "tax",
  "refund",
  "income",
  "unknown",
] as const;

export type ImportRowKind = (typeof IMPORT_ROW_KINDS)[number];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date (YYYY-MM-DD)");

const currencyCode = z.string().regex(/^[A-Z]{3}$/, "expected 3-letter currency code");

// Source-specific extras (dedupe_key, card_last4, exchange_rate, …).
// dedupe_key is always present in practice but we don't hard-require it —
// engine.ts falls back gracefully if it's ever missing.
export const extractedRowExtraSchema = z
  .object({
    dedupe_key: z.string().optional(),
  })
  .loose();

export const extractedRowSchema = z.object({
  date: isoDate,
  description: z.string(),
  amount_minor: z.number().int(),
  currency: currencyCode,
  kind: z.enum(IMPORT_ROW_KINDS),
  merchant: z.string().nullable().optional().default(null),
  original_amount_minor: z.number().int().nullable().optional().default(null),
  original_currency: currencyCode.nullable().optional().default(null),
  cardholder: z.string().nullable().optional().default(null),
  place: z.string().nullable().optional().default(null),
  source_id: z.string().nullable().optional().default(null),
  balance_minor: z.number().int().nullable().optional().default(null),
  extra: extractedRowExtraSchema.default({}),
  raw: z.string(),
});

export type ExtractedRow = z.infer<typeof extractedRowSchema>;

export const accountHintSchema = z
  .object({
    name: z.string(),
    type: z.enum(["checking", "savings", "cash", "credit_card"]),
    // Null when the statement mixes currencies (e.g. Santander ARS+USD) —
    // each currency present in `rows` maps to its own app account.
    currency: currencyCode.nullable(),
  })
  .loose();

export type AccountHint = z.infer<typeof accountHintSchema>;

// Statement-level metadata (closing balances, opening balances, statement
// dates…) — entirely source-specific, kept as a passthrough bag.
export const importMetaSchema = z.record(z.string(), z.unknown()).default({});

// What the extraction pipeline validated (running-balance chains, subtotal
// reconciliation…) — informational only, not consumed by the app.
export const importValidationSchema = z.record(z.string(), z.unknown()).default({});

export const extractedStatementSchema = z.object({
  source: z.string(),
  source_file: z.string(),
  file_sha256: z.string(),
  account_hint: accountHintSchema,
  meta: importMetaSchema,
  validation: importValidationSchema,
  warnings: z.array(z.string()).default([]),
  rows: z.array(extractedRowSchema),
});

export type ExtractedStatement = z.infer<typeof extractedStatementSchema>;

/** Parse + validate a statement JSON file's contents. Throws a descriptive
 *  Error (includes the zod issue path) on malformed input. */
export function parseExtractedStatement(json: string): ExtractedStatement {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `Failed to parse extracted statement JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = extractedStatementSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid extracted statement JSON: ${issues}`);
  }
  return result.data;
}
