// Ingest endpoint for phone wallet captures (Phase 1.7). Bearer device-token
// auth (no session). Never 4xxes on unparseable CONTENT — bad payloads are
// stored as `unparsed` captures for the /wallet inbox; only auth failures
// and empty bodies are rejected.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  households,
  memberships,
  walletCaptures,
  walletCardMappings,
  walletDevices,
} from "@/db/schema";
import type { CategoryRule } from "@/lib/import/engine";
import { listCategoryRules, usablePostingAccount } from "@/lib/queries";
import { bookCapture } from "@/lib/wallet/book";
import {
  amountToMinor,
  captureHash,
  normalizeCardKey,
  parseCapture,
} from "@/lib/wallet/engine";
import { hashDeviceToken } from "@/lib/wallet/tokens";
import { capturePayloadSchema, type CapturePayload } from "@/lib/wallet/types";

/** Body → payload. Falls back to wrapping the raw text as an unstructured
 *  android payload when JSON parsing fails (MacroDroid can't JSON-escape
 *  notification text) — a capture is never lost to a quoting bug. */
async function readPayload(req: Request): Promise<CapturePayload | null> {
  const bodyText = await req.text();
  try {
    const parsed = capturePayloadSchema.safeParse(JSON.parse(bodyText));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to the raw wrapper
  }
  const trimmed = bodyText.trim();
  if (!trimmed) return null;
  return {
    kind: "android_notification",
    app: "unknown",
    title: "",
    text: trimmed.slice(0, 4000),
    postedAt: new Date().toISOString(),
  };
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const device = await db.query.walletDevices.findFirst({
    where: and(
      eq(walletDevices.tokenHash, hashDeviceToken(token)),
      isNull(walletDevices.revokedAt),
    ),
  });
  if (!device) return Response.json({ error: "unauthorized" }, { status: 401 });

  const payload = await readPayload(req);
  if (!payload) return Response.json({ error: "empty body" }, { status: 400 });

  const membership = await db.query.memberships.findFirst({
    where: eq(memberships.userId, device.userId),
  });
  if (!membership) {
    return Response.json({ error: "device user has no household" }, { status: 403 });
  }
  const householdId = membership.householdId;

  const parsed = parseCapture(payload);
  const cardKey = parsed?.cardKey ? normalizeCardKey(parsed.cardKey) : null;

  // Resolve card → account (only meaningful when parse succeeded).
  let account: { id: string; currency: string } | null = null;
  if (parsed && cardKey) {
    const mapping = await db.query.walletCardMappings.findFirst({
      where: and(
        eq(walletCardMappings.userId, device.userId),
        eq(walletCardMappings.cardKey, cardKey),
      ),
    });
    if (mapping) {
      const row = await usablePostingAccount(householdId, device.userId, mapping.accountId);
      if (row) account = { id: row.id, currency: row.currency };
    }
  }

  // Display-only parsed columns; booking re-derives from `raw`.
  let amountMinor: number | null = null;
  if (parsed?.currency) {
    try {
      amountMinor = amountToMinor(parsed.amountRaw, parsed.currency);
    } catch {
      amountMinor = null;
    }
  }

  const inserted = await db
    .insert(walletCaptures)
    .values({
      deviceId: device.id,
      kind: payload.kind,
      raw: payload,
      captureHash: captureHash(device.id, payload),
      status: parsed ? "needs_account" : "unparsed",
      amountMinor,
      currency: parsed?.currency ?? null,
      merchant: parsed?.merchant ?? null,
      cardKey,
    })
    .onConflictDoNothing({ target: walletCaptures.captureHash })
    .returning({ id: walletCaptures.id });

  await db
    .update(walletDevices)
    .set({ lastSeenAt: new Date() })
    .where(eq(walletDevices.id, device.id));

  if (inserted.length === 0) return Response.json({ duplicate: true }, { status: 200 });
  const captureId = inserted[0].id;

  if (parsed && account) {
    const [household, ruleRows] = await Promise.all([
      db.query.households.findFirst({ where: eq(households.id, householdId) }),
      listCategoryRules(householdId),
    ]);
    const rules: CategoryRule[] = ruleRows.map((r) => r.rule);
    const txnId = await bookCapture({
      capture: { id: captureId, raw: payload },
      account,
      householdId,
      userId: device.userId,
      baseCurrency: household!.baseCurrency,
      rules,
    });
    if (txnId) {
      return Response.json({ id: captureId, status: "booked" }, { status: 201 });
    }
    // Parse was OK but booking failed (e.g. missing FX rate) — capture
    // stays needs_account and can be booked from the inbox later.
  }

  return Response.json(
    { id: captureId, status: parsed ? "needs_account" : "unparsed" },
    { status: 201 },
  );
}
