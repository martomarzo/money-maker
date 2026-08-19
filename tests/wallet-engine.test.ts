import { describe, expect, it } from "vitest";
import {
  amountToMinor,
  captureHash,
  captureHashRaw,
  normalizeCardKey,
} from "@/lib/wallet/engine";
import { generateDeviceToken, hashDeviceToken } from "@/lib/wallet/tokens";
import {
  capturePayloadSchema,
  normalizeIsoDateTime,
  type CapturePayload,
} from "@/lib/wallet/types";

const androidPayload: CapturePayload = {
  kind: "android_notification",
  app: "com.google.android.apps.walletnfcrel",
  title: "€4,50 with Visa •••• 1234",
  text: "Starbucks",
  postedAt: "2026-08-19T12:34:56Z",
};

describe("capturePayloadSchema", () => {
  it("accepts an android payload", () => {
    expect(capturePayloadSchema.parse(androidPayload)).toEqual(androidPayload);
  });

  it("accepts an ios payload and defaults optional text fields", () => {
    const parsed = capturePayloadSchema.parse({
      kind: "ios_transaction",
      amount: "4.50",
      postedAt: "2026-08-19T12:34:56Z",
    });
    expect(parsed).toMatchObject({ merchant: "", cardName: "" });
  });

  it("rejects an unknown kind and a missing postedAt", () => {
    expect(capturePayloadSchema.safeParse({ kind: "nope" }).success).toBe(false);
    expect(
      capturePayloadSchema.safeParse({ ...androidPayload, postedAt: undefined })
        .success,
    ).toBe(false);
  });

  it("accepts unpadded date/hour tokens and normalizes postedAt", () => {
    const parsed = capturePayloadSchema.parse({
      ...androidPayload,
      postedAt: "2026-8-9T4:05:00",
    });
    expect(parsed.postedAt).toBe("2026-08-09T04:05:00");
  });
});

describe("normalizeIsoDateTime", () => {
  it("zero-pads unpadded month/day/hour", () => {
    expect(normalizeIsoDateTime("2026-8-9T4:05:00")).toBe("2026-08-09T04:05:00");
  });

  it("leaves an already-padded datetime unchanged", () => {
    expect(normalizeIsoDateTime("2026-08-19T12:34:56Z")).toBe("2026-08-19T12:34:56Z");
  });

  it("returns non-matching input unchanged", () => {
    expect(normalizeIsoDateTime("not a date")).toBe("not a date");
  });
});

describe("captureHash", () => {
  it("is stable for the same device + payload", () => {
    expect(captureHash("dev-1", androidPayload)).toBe(
      captureHash("dev-1", { ...androidPayload }),
    );
  });

  it("differs across devices and across postedAt", () => {
    expect(captureHash("dev-2", androidPayload)).not.toBe(
      captureHash("dev-1", androidPayload),
    );
    expect(
      captureHash("dev-1", { ...androidPayload, postedAt: "2026-08-19T12:35:00Z" }),
    ).not.toBe(captureHash("dev-1", androidPayload));
  });
});

describe("captureHashRaw", () => {
  it("is stable for the same device + body text", () => {
    expect(captureHashRaw("dev-1", "some raw body")).toBe(
      captureHashRaw("dev-1", "some raw body"),
    );
  });

  it("differs across devices and across bodies", () => {
    expect(captureHashRaw("dev-2", "some raw body")).not.toBe(
      captureHashRaw("dev-1", "some raw body"),
    );
    expect(captureHashRaw("dev-1", "other body")).not.toBe(
      captureHashRaw("dev-1", "some raw body"),
    );
  });

  it("returns a 64-char hex digest", () => {
    expect(captureHashRaw("dev-1", "some raw body")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("tokens", () => {
  it("generates distinct url-safe tokens and hashes deterministically", () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hashDeviceToken(a)).toBe(hashDeviceToken(a));
    expect(hashDeviceToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("normalizeCardKey", () => {
  it("lowercases and trims", () => {
    expect(normalizeCardKey("  Revolut ")).toBe("revolut");
    expect(normalizeCardKey("1234")).toBe("1234");
  });
});

describe("amountToMinor", () => {
  it("handles 2-decimal currencies via toCents", () => {
    expect(amountToMinor("4,50", "EUR")).toBe(450);
    expect(amountToMinor("1.234,56", "ARS")).toBe(123456);
    expect(amountToMinor("1,234.56", "USD")).toBe(123456);
    expect(amountToMinor("12.50", "EUR")).toBe(1250);
  });

  it("treats separators as thousands in zero-decimal currencies", () => {
    expect(amountToMinor("25.000", "PYG")).toBe(25000);
    expect(amountToMinor("1,500,000", "PYG")).toBe(1500000);
  });

  it("throws on garbage", () => {
    expect(() => amountToMinor("abc", "EUR")).toThrow();
    expect(() => amountToMinor("12a", "PYG")).toThrow();
  });
});
