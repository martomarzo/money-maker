import { describe, expect, it } from "vitest";
import {
  centsToDecimalString,
  convertCents,
  decimalsFor,
  formatCents,
  toCents,
} from "@/lib/domain/money";

describe("toCents", () => {
  it("parses plain decimal strings", () => {
    expect(toCents("1234.56")).toBe(123456);
    expect(toCents("0.01")).toBe(1);
    expect(toCents("10")).toBe(1000);
  });

  it("parses comma-decimal (Latin) formats", () => {
    expect(toCents("1.234,56")).toBe(123456);
    expect(toCents("12,50")).toBe(1250);
  });

  it("parses thousands-separated English format", () => {
    expect(toCents("1,234.56")).toBe(123456);
  });

  it("handles negatives", () => {
    expect(toCents("-45.10")).toBe(-4510);
    expect(toCents(-45.1)).toBe(-4510);
  });

  it("handles zero-decimal currencies (PYG)", () => {
    expect(toCents("150000", "PYG")).toBe(150000);
    expect(toCents("1.500.000,00", "PYG")).toBe(1500000);
  });

  it("truncates excess precision instead of rounding up silently", () => {
    expect(toCents("1.999")).toBe(199);
  });

  it("rejects garbage", () => {
    expect(() => toCents("abc")).toThrow();
    expect(() => toCents("12.34.56")).toThrow();
    expect(() => toCents(NaN)).toThrow();
    expect(() => toCents(Infinity)).toThrow();
  });

  it("round-trips numbers without float drift", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(19.99)).toBe(1999);
  });
});

describe("centsToDecimalString", () => {
  it("formats standard currencies", () => {
    expect(centsToDecimalString(123456)).toBe("1234.56");
    expect(centsToDecimalString(1)).toBe("0.01");
    expect(centsToDecimalString(-4510)).toBe("-45.10");
    expect(centsToDecimalString(0)).toBe("0.00");
  });

  it("formats zero-decimal currencies", () => {
    expect(centsToDecimalString(150000, "PYG")).toBe("150000");
  });

  it("round-trips with toCents", () => {
    for (const cents of [0, 1, 99, 100, 123456, -1, -123456]) {
      expect(toCents(centsToDecimalString(cents))).toBe(cents);
    }
  });
});

describe("convertCents", () => {
  it("converts EUR to USD", () => {
    // 100.00 EUR at 1.09 → 109.00 USD
    expect(convertCents(10000, 1.09, "EUR", "USD")).toBe(10900);
  });

  it("converts EUR to PYG (2-decimal → 0-decimal)", () => {
    // 10.00 EUR at 8100 → 81,000 PYG (integer guaraníes)
    expect(convertCents(1000, 8100, "EUR", "PYG")).toBe(81000);
  });

  it("converts PYG to EUR (0-decimal → 2-decimal)", () => {
    // 81,000 PYG at 1/8100 → 10.00 EUR
    expect(convertCents(81000, 1 / 8100, "PYG", "EUR")).toBe(1000);
  });

  it("preserves sign", () => {
    expect(convertCents(-10000, 1.09, "EUR", "USD")).toBe(-10900);
  });
});

describe("decimalsFor", () => {
  it("knows PYG has no minor unit", () => {
    expect(decimalsFor("PYG")).toBe(0);
    expect(decimalsFor("pyg")).toBe(0);
  });
  it("defaults to 2", () => {
    expect(decimalsFor("EUR")).toBe(2);
    expect(decimalsFor("ARS")).toBe(2);
  });
});

describe("formatCents", () => {
  it("formats EUR", () => {
    expect(formatCents(123456, "EUR")).toBe("€1,234.56");
  });
  it("formats PYG without decimals", () => {
    const out = formatCents(150000, "PYG");
    expect(out).toContain("150,000");
    expect(out).not.toContain(".00");
  });
});
