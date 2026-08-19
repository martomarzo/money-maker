import { describe, expect, it } from "vitest";
import type { CategoryRule } from "@/lib/import/engine";
import {
  findAmount,
  parseAndroidNotification,
  parseCapture,
  parseIosTransaction,
  suggestCategoryForMerchant,
} from "@/lib/wallet/engine";

const POSTED = "2026-08-19T12:34:56Z";

describe("findAmount", () => {
  it("recognizes euro symbol with comma decimals", () => {
    expect(findAmount("€4,50 with Visa")).toEqual({ amountRaw: "4,50", currency: "EUR" });
  });
  it("recognizes guarani thousands", () => {
    expect(findAmount("₲ 25.000 con Mastercard")).toEqual({ amountRaw: "25.000", currency: "PYG" });
    expect(findAmount("Gs. 150.000")).toEqual({ amountRaw: "150.000", currency: "PYG" });
  });
  it("recognizes US$ before bare $", () => {
    expect(findAmount("US$ 12.99")).toEqual({ amountRaw: "12.99", currency: "USD" });
  });
  it("returns null currency for a bare $ (ambiguous)", () => {
    expect(findAmount("$1.234,56 en Coto")).toEqual({ amountRaw: "1.234,56", currency: null });
  });
  it("matches amount-before-code order too", () => {
    expect(findAmount("12.50 EUR")).toEqual({ amountRaw: "12.50", currency: "EUR" });
  });
  it("returns null when there is no currency-adjacent amount", () => {
    expect(findAmount("Your card ending 1234 was added")).toBeNull();
    expect(findAmount("")).toBeNull();
  });
});

describe("parseAndroidNotification", () => {
  it("parses the classic Google Wallet shape (amount+card in title, merchant in text)", () => {
    const p = parseAndroidNotification("€4,50 with Visa •••• 1234", "Starbucks", POSTED);
    expect(p).toEqual({
      amountRaw: "4,50",
      currency: "EUR",
      merchant: "Starbucks",
      cardKey: "1234",
      date: "2026-08-19",
    });
  });

  it("parses an 'at MERCHANT with' sentence and 'ending in' last4", () => {
    const p = parseAndroidNotification(
      "Payment",
      "You paid US$12.99 at Amazon with Mastercard ending in 5678",
      POSTED,
    );
    expect(p).toMatchObject({ amountRaw: "12.99", currency: "USD", merchant: "Amazon", cardKey: "5678" });
  });

  it("parses a Spanish guarani notification", () => {
    const p = parseAndroidNotification("₲ 25.000 con Visa •• 9012", "Pago en Superseis", POSTED);
    expect(p).toMatchObject({ amountRaw: "25.000", currency: "PYG", merchant: "Superseis", cardKey: "9012" });
  });

  it("returns null for a non-payment notification", () => {
    expect(parseAndroidNotification("Google Wallet", "Your card was added to Wallet", POSTED)).toBeNull();
  });
});

describe("parseIosTransaction", () => {
  it("uses the explicit currency field when present", () => {
    const p = parseIosTransaction({ merchant: "Farmacia Catedral", amount: "€7.20", currency: "eur", cardName: "Revolut", postedAt: POSTED });
    expect(p).toMatchObject({ amountRaw: "7.20", currency: "EUR", merchant: "Farmacia Catedral", cardKey: "revolut" });
  });

  it("accepts a bare numeric amount with no currency", () => {
    const p = parseIosTransaction({ merchant: "M", amount: "12.50", cardName: "Wise", postedAt: POSTED });
    expect(p).toMatchObject({ amountRaw: "12.50", currency: null });
  });

  it("returns null when amount is not numeric", () => {
    expect(parseIosTransaction({ merchant: "M", amount: "pending", cardName: "", postedAt: POSTED })).toBeNull();
  });
});

describe("parseCapture", () => {
  it("dispatches on kind", () => {
    expect(
      parseCapture({ kind: "android_notification", app: "x", title: "€1,00 with Visa •••• 1111", text: "Shop", postedAt: POSTED }),
    ).toMatchObject({ currency: "EUR" });
    expect(
      parseCapture({ kind: "ios_transaction", merchant: "Shop", amount: "1.00", currency: "EUR", cardName: "Revolut", postedAt: POSTED }),
    ).toMatchObject({ cardKey: "revolut" });
  });
});

describe("suggestCategoryForMerchant", () => {
  const rules: CategoryRule[] = [
    { id: "r1", matchText: "starbucks", accountId: null, currency: null, categoryId: "cat-coffee", priority: 0 },
  ];
  it("matches accent/case-insensitively via the import engine", () => {
    expect(suggestCategoryForMerchant("STARBUCKS Madrid", "EUR", "acc-1", rules)).toBe("cat-coffee");
  });
  it("returns null with no merchant or no match", () => {
    expect(suggestCategoryForMerchant(null, "EUR", "acc-1", rules)).toBeNull();
    expect(suggestCategoryForMerchant("Lidl", "EUR", "acc-1", rules)).toBeNull();
  });
});
