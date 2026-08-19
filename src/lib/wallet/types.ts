// Zod contract for POST /api/wallet/capture. Two payload kinds:
// android_notification = raw notification text forwarded by MacroDroid
// (server parses it); ios_transaction = already-structured fields from the
// iOS Shortcuts "Transaction" automation trigger.

import { z } from "zod";

const isoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "expected ISO-8601 datetime");

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
