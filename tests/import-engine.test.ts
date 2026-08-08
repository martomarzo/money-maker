import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  draftFromRow,
  draftsFromStatement,
  findInBatchDuplicates,
  matchTransferLegs,
  normalizeMatchText,
  suggestCategory,
  type CategoryRule,
  type TransactionDraft,
  type TransferLegEntry,
} from "@/lib/import/engine";
import { parseExtractedStatement, type ExtractedRow } from "@/lib/import/types";

const FIXTURE_DIR = path.join(__dirname, "fixtures", "import");

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), "utf-8");
}

/** Builds a synthetic ExtractedRow with sensible defaults, overridable per test. */
function makeRow(overrides: Partial<ExtractedRow> = {}): ExtractedRow {
  return {
    date: "2026-01-15",
    description: "Test description",
    amount_minor: -1000,
    currency: "EUR",
    kind: "purchase",
    merchant: null,
    original_amount_minor: null,
    original_currency: null,
    cardholder: null,
    place: null,
    source_id: null,
    balance_minor: null,
    extra: { dedupe_key: "test-dedupe-key" },
    raw: "raw source line",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseExtractedStatement
// ---------------------------------------------------------------------------

describe("parseExtractedStatement", () => {
  it("parses a real-shaped dual-currency statement fixture", () => {
    const stmt = parseExtractedStatement(loadFixture("dual-currency-statement.json"));
    expect(stmt.source).toBe("fixture_bank_account");
    expect(stmt.account_hint.currency).toBeNull();
    // account_hint carries source-specific extras (e.g. "note") via passthrough.
    expect((stmt.account_hint as { note?: string }).note).toBe(
      "one app account per currency present in rows",
    );
    expect(stmt.rows).toHaveLength(5);
    expect(stmt.rows[0].amount_minor).toBe(-350000);
    expect(stmt.meta.opening_balance_ars).toBe(100000);
  });

  it("throws a descriptive error on malformed JSON", () => {
    expect(() => parseExtractedStatement("{not json")).toThrow(
      /Failed to parse extracted statement JSON/,
    );
  });

  it("throws a descriptive error when required fields are missing", () => {
    const bad = JSON.stringify({ source: "x" });
    expect(() => parseExtractedStatement(bad)).toThrow(/Invalid extracted statement JSON/);
  });

  it("throws when a row has an unrecognized kind", () => {
    const stmt = JSON.parse(loadFixture("dual-currency-statement.json"));
    stmt.rows[0].kind = "not-a-real-kind";
    expect(() => parseExtractedStatement(JSON.stringify(stmt))).toThrow();
  });

  it("is tolerant of extra passthrough fields in meta and extra", () => {
    const stmt = JSON.parse(loadFixture("dual-currency-statement.json"));
    stmt.meta.some_unknown_future_field = 42;
    stmt.rows[0].extra.some_bank_specific_field = "whatever";
    const parsed = parseExtractedStatement(JSON.stringify(stmt));
    expect(parsed.meta.some_unknown_future_field).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// draftFromRow — kind → type mapping
// ---------------------------------------------------------------------------

describe("draftFromRow", () => {
  it("maps purchase/fee/tax to expense (positive amountCents)", () => {
    for (const kind of ["purchase", "fee", "tax"] as const) {
      const draft = draftFromRow(makeRow({ kind, amount_minor: -1234 }), 0);
      expect(draft.type).toBe("expense");
      expect(draft.amountCents).toBe(1234);
    }
  });

  it("maps income/refund to income (positive amountCents)", () => {
    for (const kind of ["income", "refund"] as const) {
      const draft = draftFromRow(makeRow({ kind, amount_minor: 5000 }), 0);
      expect(draft.type).toBe("income");
      expect(draft.amountCents).toBe(5000);
    }
  });

  it("maps transfer/exchange/payment to transfer, preserving sign", () => {
    for (const kind of ["transfer", "exchange", "payment"] as const) {
      const outflow = draftFromRow(makeRow({ kind, amount_minor: -7500 }), 0);
      expect(outflow.type).toBe("transfer");
      expect(outflow.amountCents).toBe(-7500);

      const inflow = draftFromRow(makeRow({ kind, amount_minor: 7500 }), 1);
      expect(inflow.type).toBe("transfer");
      expect(inflow.amountCents).toBe(7500);
    }
  });

  it("maps unknown by sign: negative → expense, positive → income", () => {
    const negative = draftFromRow(makeRow({ kind: "unknown", amount_minor: -300 }), 0);
    expect(negative.type).toBe("expense");
    expect(negative.amountCents).toBe(300);

    const positive = draftFromRow(makeRow({ kind: "unknown", amount_minor: 300 }), 1);
    expect(positive.type).toBe("income");
    expect(positive.amountCents).toBe(300);
  });

  it("uses merchant over description for payee, trimmed", () => {
    const withMerchant = draftFromRow(
      makeRow({ merchant: "  Acme Corp  ", description: "some raw description" }),
      0,
    );
    expect(withMerchant.payee).toBe("Acme Corp");

    const withoutMerchant = draftFromRow(
      makeRow({ merchant: null, description: "  Fallback description  " }),
      0,
    );
    expect(withoutMerchant.payee).toBe("Fallback description");
  });

  it("builds notes from cardholder and foreign-purchase place (Itaú-like)", () => {
    const draft = draftFromRow(
      makeRow({
        kind: "purchase",
        currency: "PYG",
        amount_minor: -661088,
        cardholder: "MARZORATI, MARTIN",
        place: "exterior",
        description: "BAGHDAD JEWELLERY-SO",
      }),
      0,
    );
    expect(draft.notes).toBe("Cardholder: MARZORATI, MARTIN · Foreign purchase");
    expect(draft.currency).toBe("PYG");
    expect(draft.amountCents).toBe(661088);
  });

  it("returns null notes when there's nothing to say", () => {
    const draft = draftFromRow(makeRow({ cardholder: null, place: null }), 0);
    expect(draft.notes).toBeNull();
  });

  it("does not add a foreign-purchase note for place=paraguay", () => {
    const draft = draftFromRow(makeRow({ place: "paraguay" }), 0);
    expect(draft.notes).toBeNull();
  });

  it("carries through original amount/currency for pre-converted card spend (Wise-like)", () => {
    const draft = draftFromRow(
      makeRow({
        kind: "purchase",
        currency: "EUR",
        amount_minor: -5287,
        original_amount_minor: -6177,
        original_currency: "USD",
        description: "Card purchase abroad",
      }),
      0,
    );
    expect(draft.originalAmountCents).toBe(-6177);
    expect(draft.originalCurrency).toBe("USD");
  });

  it("preserves index and sourceHash from extra.dedupe_key", () => {
    const draft = draftFromRow(
      makeRow({ extra: { dedupe_key: "abc123" } }),
      7,
    );
    expect(draft.index).toBe(7);
    expect(draft.sourceHash).toBe("abc123");
  });

  it("sourceHash is null when extra has no dedupe_key", () => {
    const draft = draftFromRow(makeRow({ extra: {} }), 0);
    expect(draft.sourceHash).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// draftsFromStatement
// ---------------------------------------------------------------------------

describe("draftsFromStatement", () => {
  it("drafts every row and lists currencies in order of first appearance (Santander-like)", () => {
    const stmt = parseExtractedStatement(loadFixture("dual-currency-statement.json"));
    const { drafts, currencies } = draftsFromStatement(stmt);
    expect(drafts).toHaveLength(5);
    // Fixture rows go ARS, ARS, ARS, USD, ARS — first appearance order is ARS, USD.
    expect(currencies).toEqual(["ARS", "USD"]);
  });
});

// ---------------------------------------------------------------------------
// findInBatchDuplicates
// ---------------------------------------------------------------------------

describe("findInBatchDuplicates", () => {
  function draft(overrides: Partial<TransactionDraft>): TransactionDraft {
    return {
      index: 0,
      date: "2026-01-01",
      type: "expense",
      amountCents: 100,
      currency: "EUR",
      payee: "x",
      notes: null,
      originalAmountCents: null,
      originalCurrency: null,
      sourceHash: "hash-a",
      kind: "purchase",
      ...overrides,
    };
  }

  it("flags all members of a same-currency duplicate group", () => {
    const drafts = [
      draft({ index: 0, sourceHash: "hash-a" }),
      draft({ index: 1, sourceHash: "hash-b" }),
      draft({ index: 2, sourceHash: "hash-a" }),
    ];
    expect(findInBatchDuplicates(drafts)).toEqual([0, 2]);
  });

  it("does not flag the same hash across different currencies", () => {
    const drafts = [
      draft({ index: 0, sourceHash: "hash-a", currency: "ARS" }),
      draft({ index: 1, sourceHash: "hash-a", currency: "USD" }),
    ];
    expect(findInBatchDuplicates(drafts)).toEqual([]);
  });

  it("ignores drafts with a null sourceHash", () => {
    const drafts = [
      draft({ index: 0, sourceHash: null }),
      draft({ index: 1, sourceHash: null }),
    ];
    expect(findInBatchDuplicates(drafts)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// matchTransferLegs
// ---------------------------------------------------------------------------

describe("matchTransferLegs", () => {
  function transferDraft(overrides: Partial<TransactionDraft>): TransactionDraft {
    return {
      index: 0,
      date: "2026-01-01",
      type: "transfer",
      amountCents: -10000,
      currency: "ARS",
      payee: "x",
      notes: null,
      originalAmountCents: null,
      originalCurrency: null,
      sourceHash: null,
      kind: "transfer",
      ...overrides,
    };
  }

  it("pairs same-currency opposite-signed legs across accounts within 3 days", () => {
    const entries: TransferLegEntry[] = [
      { draft: transferDraft({ index: 0, amountCents: -10000, date: "2026-01-05" }), accountKey: "ars-account" },
      { draft: transferDraft({ index: 1, amountCents: 10000, date: "2026-01-07" }), accountKey: "usd-account" },
    ];
    const pairs = matchTransferLegs(entries);
    expect(pairs).toEqual([[0, 1]]);
  });

  it("does not pair legs more than 3 days apart", () => {
    const entries: TransferLegEntry[] = [
      { draft: transferDraft({ index: 0, amountCents: -10000, date: "2026-01-01" }), accountKey: "a" },
      { draft: transferDraft({ index: 1, amountCents: 10000, date: "2026-01-06" }), accountKey: "b" },
    ];
    expect(matchTransferLegs(entries)).toEqual([]);
  });

  it("does not pair legs in the same account", () => {
    const entries: TransferLegEntry[] = [
      { draft: transferDraft({ index: 0, amountCents: -10000, date: "2026-01-01" }), accountKey: "a" },
      { draft: transferDraft({ index: 1, amountCents: 10000, date: "2026-01-01" }), accountKey: "a" },
    ];
    expect(matchTransferLegs(entries)).toEqual([]);
  });

  it("does not pair legs with the same sign", () => {
    const entries: TransferLegEntry[] = [
      { draft: transferDraft({ index: 0, amountCents: -10000, date: "2026-01-01" }), accountKey: "a" },
      { draft: transferDraft({ index: 1, amountCents: -10000, date: "2026-01-01" }), accountKey: "b" },
    ];
    expect(matchTransferLegs(entries)).toEqual([]);
  });

  it("prefers the closest date among multiple same-currency candidates", () => {
    const entries: TransferLegEntry[] = [
      { draft: transferDraft({ index: 0, amountCents: -10000, date: "2026-01-05" }), accountKey: "a" },
      { draft: transferDraft({ index: 1, amountCents: 10000, date: "2026-01-05" }), accountKey: "b" }, // exact match
      { draft: transferDraft({ index: 2, amountCents: 10000, date: "2026-01-07" }), accountKey: "c" }, // 2 days off
    ];
    const pairs = matchTransferLegs(entries);
    expect(pairs).toEqual([[0, 1]]);
  });

  it("matches cross-currency legs only when both are exchange kind and same date (Revolut-like)", () => {
    const entries: TransferLegEntry[] = [
      {
        draft: transferDraft({
          index: 0,
          kind: "exchange",
          currency: "USD",
          amountCents: -10000,
          date: "2026-01-05",
        }),
        accountKey: "usd-account",
      },
      {
        draft: transferDraft({
          index: 1,
          kind: "exchange",
          currency: "EUR",
          amountCents: 9200,
          date: "2026-01-05",
        }),
        accountKey: "eur-account",
      },
    ];
    expect(matchTransferLegs(entries)).toEqual([[0, 1]]);
  });

  it("does not match cross-currency legs on different dates even if both are exchange", () => {
    const entries: TransferLegEntry[] = [
      {
        draft: transferDraft({ index: 0, kind: "exchange", currency: "USD", amountCents: -10000, date: "2026-01-05" }),
        accountKey: "usd-account",
      },
      {
        draft: transferDraft({ index: 1, kind: "exchange", currency: "EUR", amountCents: 9200, date: "2026-01-06" }),
        accountKey: "eur-account",
      },
    ];
    expect(matchTransferLegs(entries)).toEqual([]);
  });

  it("does not match cross-currency legs when either kind is not exchange", () => {
    const entries: TransferLegEntry[] = [
      {
        draft: transferDraft({ index: 0, kind: "transfer", currency: "USD", amountCents: -10000, date: "2026-01-05" }),
        accountKey: "usd-account",
      },
      {
        draft: transferDraft({ index: 1, kind: "exchange", currency: "EUR", amountCents: 9200, date: "2026-01-05" }),
        accountKey: "eur-account",
      },
    ];
    expect(matchTransferLegs(entries)).toEqual([]);
  });

  it("each leg pairs at most once and unmatched legs are simply omitted", () => {
    const entries: TransferLegEntry[] = [
      { draft: transferDraft({ index: 0, amountCents: -10000, date: "2026-01-05" }), accountKey: "a" },
      { draft: transferDraft({ index: 1, amountCents: 10000, date: "2026-01-05" }), accountKey: "b" },
      { draft: transferDraft({ index: 2, amountCents: 10000, date: "2026-01-05" }), accountKey: "c" }, // unmatched leftover
    ];
    const pairs = matchTransferLegs(entries);
    expect(pairs).toHaveLength(1);
    const matchedIndices = new Set(pairs.flat());
    expect(matchedIndices.has(2)).toBe(false);
  });

  it("ignores non-transfer drafts entirely", () => {
    const entries: TransferLegEntry[] = [
      { draft: transferDraft({ index: 0, type: "expense", amountCents: -10000 }), accountKey: "a" },
      { draft: transferDraft({ index: 1, type: "income", amountCents: 10000 }), accountKey: "b" },
    ];
    expect(matchTransferLegs(entries)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeMatchText
// ---------------------------------------------------------------------------

describe("normalizeMatchText", () => {
  it("lowercases and strips accents", () => {
    expect(normalizeMatchText("FARMACIA ITURRIETA")).toBe("farmacia iturrieta");
    expect(normalizeMatchText("Café")).toBe("cafe");
    expect(normalizeMatchText("Compañía Ñañez")).toBe("compania nanez");
  });
});

// ---------------------------------------------------------------------------
// suggestCategory
// ---------------------------------------------------------------------------

describe("suggestCategory", () => {
  function draft(overrides: Partial<TransactionDraft> = {}): TransactionDraft {
    return {
      index: 0,
      date: "2026-01-01",
      type: "expense",
      amountCents: 5000,
      currency: "PYG",
      payee: "FARMACIA ITURRIETA",
      notes: null,
      originalAmountCents: null,
      originalCurrency: null,
      sourceHash: null,
      kind: "purchase",
      ...overrides,
    };
  }

  function rule(overrides: Partial<CategoryRule>): CategoryRule {
    return {
      id: "rule-1",
      matchText: "farmacia",
      accountId: null,
      currency: null,
      categoryId: "cat-pharmacy",
      priority: 0,
      ...overrides,
    };
  }

  it("matches accent/case-insensitively against payee", () => {
    const result = suggestCategory(draft(), [rule({ matchText: "farmacia" })]);
    expect(result).toBe("cat-pharmacy");
  });

  it("matches against notes too", () => {
    const result = suggestCategory(
      draft({ payee: "Some Store", notes: "Cardholder: FARMACIA ITURRIETA" }),
      [rule({ matchText: "farmacia" })],
    );
    expect(result).toBe("cat-pharmacy");
  });

  it("returns null when no rule matches", () => {
    const result = suggestCategory(draft(), [rule({ matchText: "supermercado" })]);
    expect(result).toBeNull();
  });

  it("picks the lowest-priority match when multiple rules match", () => {
    const result = suggestCategory(draft(), [
      rule({ id: "r1", matchText: "farmacia", categoryId: "cat-low-prio", priority: 5 }),
      rule({ id: "r2", matchText: "farmacia", categoryId: "cat-high-prio", priority: 1 }),
    ]);
    expect(result).toBe("cat-high-prio");
  });

  it("breaks priority ties with the longest matchText", () => {
    const result = suggestCategory(draft(), [
      rule({ id: "r1", matchText: "farmacia", categoryId: "cat-short", priority: 1 }),
      rule({ id: "r2", matchText: "farmacia iturrieta", categoryId: "cat-long", priority: 1 }),
    ]);
    expect(result).toBe("cat-long");
  });

  it("filters out rules scoped to a different currency", () => {
    const result = suggestCategory(draft({ currency: "PYG" }), [
      rule({ matchText: "farmacia", currency: "USD" }),
    ]);
    expect(result).toBeNull();
  });

  it("allows currency-scoped rules matching the draft's currency", () => {
    const result = suggestCategory(draft({ currency: "PYG" }), [
      rule({ matchText: "farmacia", currency: "PYG" }),
    ]);
    expect(result).toBe("cat-pharmacy");
  });

  it("applies account-scoped filter only when a target accountId is given", () => {
    const rules = [rule({ matchText: "farmacia", accountId: "account-1" })];

    // No target account passed → account-scoped rule still considered.
    expect(suggestCategory(draft(), rules)).toBe("cat-pharmacy");

    // Target account matches → matches.
    expect(suggestCategory(draft(), rules, "account-1")).toBe("cat-pharmacy");

    // Target account differs → excluded.
    expect(suggestCategory(draft(), rules, "account-2")).toBeNull();
  });
});
