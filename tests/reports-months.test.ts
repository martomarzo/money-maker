import { describe, expect, it } from "vitest";
import { isMonth, monthBounds, shiftMonth } from "@/lib/reports";

describe("month helpers", () => {
  it("monthBounds covers the whole month incl. leap February", () => {
    expect(monthBounds("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("shiftMonth wraps across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(shiftMonth("2026-08", -11)).toBe("2025-09");
  });
  it("isMonth validates the YYYY-MM shape", () => {
    expect(isMonth("2026-08")).toBe(true);
    expect(isMonth("2026-8")).toBe(false);
    expect(isMonth("all")).toBe(false);
    expect(isMonth(undefined)).toBe(false);
  });
});
