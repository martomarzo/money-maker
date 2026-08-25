import { describe, expect, it } from "vitest";
import { evenSplit, validateSplit } from "@/lib/domain/split";

describe("evenSplit", () => {
  it("splits evenly among members, remainder to the payer", () => {
    expect(evenSplit(1001, "EUR", ["a", "b"], "a")).toEqual([
      { userId: "a", shareCents: 501 },
      { userId: "b", shareCents: 500 },
    ]);
  });

  it("distributes multi-cent remainders one per member starting with the payer", () => {
    // 1000 / 3 = 333 r 1 → payer gets 334
    expect(evenSplit(1000, "EUR", ["x", "y", "z"], "y")).toEqual([
      { userId: "x", shareCents: 333 },
      { userId: "y", shareCents: 334 },
      { userId: "z", shareCents: 333 },
    ]);
    // 1002 / 3 = 334 exactly
    expect(evenSplit(1002, "EUR", ["x", "y", "z"], "y").map((s) => s.shareCents)).toEqual([
      334, 334, 334,
    ]);
    // 1004 / 3 = 334 r 2 → payer +1, next member +1
    expect(evenSplit(1004, "EUR", ["x", "y", "z"], "z").map((s) => s.shareCents)).toEqual([
      335, 334, 335,
    ]);
  });

  it("works for zero-decimal currencies (units are already integers)", () => {
    expect(evenSplit(100001, "PYG", ["a", "b"], "b")).toEqual([
      { userId: "a", shareCents: 50000 },
      { userId: "b", shareCents: 50001 },
    ]);
  });

  it("single member gets everything", () => {
    expect(evenSplit(777, "EUR", ["a"], "a")).toEqual([{ userId: "a", shareCents: 777 }]);
  });

  it("payer not in members → remainder goes to the first member", () => {
    expect(evenSplit(3, "EUR", ["a", "b"], "ghost")).toEqual([
      { userId: "a", shareCents: 2 },
      { userId: "b", shareCents: 1 },
    ]);
  });

  it("rejects empty member list and negative totals", () => {
    expect(() => evenSplit(100, "EUR", [], "a")).toThrow();
    expect(() => evenSplit(-1, "EUR", ["a"], "a")).toThrow();
  });
});

describe("validateSplit", () => {
  it("accepts splits that sum to the total with no negatives or duplicates", () => {
    expect(
      validateSplit(1000, [
        { userId: "a", shareCents: 250 },
        { userId: "b", shareCents: 750 },
      ]),
    ).toEqual({ ok: true });
    expect(
      validateSplit(1000, [
        { userId: "a", shareCents: 0 },
        { userId: "b", shareCents: 1000 },
      ]),
    ).toEqual({ ok: true });
  });

  it("rejects wrong sums, negatives, duplicates and empty", () => {
    expect(validateSplit(1000, [{ userId: "a", shareCents: 999 }]).ok).toBe(false);
    expect(
      validateSplit(1000, [
        { userId: "a", shareCents: -1 },
        { userId: "b", shareCents: 1001 },
      ]).ok,
    ).toBe(false);
    expect(
      validateSplit(1000, [
        { userId: "a", shareCents: 500 },
        { userId: "a", shareCents: 500 },
      ]).ok,
    ).toBe(false);
    expect(validateSplit(1000, []).ok).toBe(false);
  });
});
