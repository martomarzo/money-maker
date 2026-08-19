// Zod contract for POST /api/wallet/capture. Two payload kinds:
// android_notification = raw notification text forwarded by MacroDroid
// (server parses it); ios_transaction = already-structured fields from the
// iOS Shortcuts "Transaction" automation trigger.

import { z } from "zod";

/** Zero-pads "2026-8-9T4:05:00" → "2026-08-09T04:05:00" so downstream
 *  date slicing and hashing see one canonical form. */
export function normalizeIsoDateTime(s: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})(.*)$/.exec(s.trim());
  if (!m) return s;
  const [, y, mo, d, h, min, rest] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${min}${rest}`;
}

const isoDateTime = z
  .string()
  .regex(/^\d{4}-\d{1,2}-\d{1,2}T\d{1,2}:\d{2}/, "expected ISO-8601 datetime")
  .transform(normalizeIsoDateTime);

export const androidCaptureSchema = z.object({
  kind: z.literal("android_notification"),
  app: z.string().min(1).max(200),
  title: z.string().max(2000).default(""),
  text: z.string().max(4000).default(""),
  postedAt: isoDateTime,
});

export const iosCaptureSchema = z.object({
  kind: z.literal("ios_transaction"),
  merchant: z.string().max(500).default(""),
  amount: z.string().min(1).max(50),
  currency: z.string().max(10).optional(),
  cardName: z.string().max(200).default(""),
  postedAt: isoDateTime,
});

export const capturePayloadSchema = z.discriminatedUnion("kind", [
  androidCaptureSchema,
  iosCaptureSchema,
]);

export type CapturePayload = z.infer<typeof capturePayloadSchema>;
