import { describe, expect, it } from "vitest";
import {
  addDays,
  composeEurArs,
  computeStats,
  daysBetween,
  dedupeSorted,
  nearestOnOrBefore,
  parseBcraResponse,
  parseFrankfurterTimeseries,
  parseFxratesapiHistorical,
  parseFxratesapiTimeseries,
  planPygFetch,
  splitByYear,
  toDbRows,
  type RatePoint,
} from "../scripts/backfill-fx";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

describe("addDays / daysBetween", () => {
  it("adds and subtracts days across month/year boundaries", () => {
    expect(addDays("2023-12-30", 3)).toBe("2024-01-02");
    expect(addDays("2024-01-01", -1)).toBe("2023-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // leap year
  });

  it("computes the day distance between two dates", () => {
    expect(daysBetween("2024-01-01", "2024-01-10")).toBe(9);
    expect(daysBetween("2024-01-10", "2024-01-01")).toBe(-9);
    expect(daysBetween("2024-01-01", "2024-01-01")).toBe(0);
  });
});

describe("splitByYear", () => {
  it("splits a multi-year range into calendar-year chunks", () => {
    expect(splitByYear("2023-12-01", "2025-08-08")).toEqual([
      ["2023-12-01", "2023-12-31"],
      ["2024-01-01", "2024-12-31"],
      ["2025-01-01", "2025-08-08"],
    ]);
  });

  it("returns a single chunk for a range within one year", () => {
    expect(splitByYear("2024-03-01", "2024-06-01")).toEqual([
      ["2024-03-01", "2024-06-01"],
    ]);
  });
});

describe("dedupeSorted / nearestOnOrBefore", () => {
  it("sorts ascending and keeps the last value for duplicate dates", () => {
    const points: RatePoint[] = [
      { date: "2024-01-03", rate: 1 },
      { date: "2024-01-01", rate: 2 },
      { date: "2024-01-01", rate: 3 }, // later duplicate wins
      { date: "2024-01-02", rate: 4 },
    ];
    expect(dedupeSorted(points)).toEqual([
      { date: "2024-01-01", rate: 3 },
      { date: "2024-01-02", rate: 4 },
      { date: "2024-01-03", rate: 1 },
    ]);
  });

  it("finds the latest point on or before a target date", () => {
    const sorted: RatePoint[] = [
      { date: "2024-01-01", rate: 1 },
      { date: "2024-01-05", rate: 2 },
      { date: "2024-01-10", rate: 3 },
    ];
    expect(nearestOnOrBefore(sorted, "2024-01-05")).toEqual({
      date: "2024-01-05",
      rate: 2,
    });
    expect(nearestOnOrBefore(sorted, "2024-01-07")).toEqual({
      date: "2024-01-05",
      rate: 2,
    });
    expect(nearestOnOrBefore(sorted, "2023-12-31")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Frankfurter (ECB) parsing — canned fixture matching the real API shape
// ---------------------------------------------------------------------------

describe("parseFrankfurterTimeseries", () => {
  const fixture = {
    amount: 1,
    base: "EUR",
    start_date: "2023-12-01",
    end_date: "2023-12-08",
    rates: {
      "2023-12-01": { USD: 1.0875 },
      "2023-12-04": { USD: 1.0868 },
      "2023-12-05": { USD: 1.0817 },
    },
  };

  it("extracts sorted rate points for the target currency", () => {
    expect(parseFrankfurterTimeseries(fixture, "USD")).toEqual([
      { date: "2023-12-01", rate: 1.0875 },
      { date: "2023-12-04", rate: 1.0868 },
      { date: "2023-12-05", rate: 1.0817 },
    ]);
  });

  it("returns an empty array when the target currency is missing", () => {
    expect(parseFrankfurterTimeseries(fixture, "GBP")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BCRA parsing + composition — canned fixture matching the real API shape,
// including the real Dec-2023 official-rate devaluation jump.
// ---------------------------------------------------------------------------

describe("parseBcraResponse", () => {
  const fixture = {
    status: 200,
    metadata: { resultset: { count: 3, offset: 0, limit: 1000 } },
    results: [
      {
        fecha: "2023-12-15",
        detalle: [
          {
            codigoMoneda: "USD",
            descripcion: "DOLAR E.E.U.U.",
            tipoPase: 0,
            tipoCotizacion: 801.1,
          },
        ],
      },
      {
        fecha: "2023-12-12",
        detalle: [
          {
            codigoMoneda: "USD",
            descripcion: "DOLAR E.E.U.U.",
            tipoPase: 0,
            tipoCotizacion: 366.45,
          },
        ],
      },
      {
        fecha: "2023-12-01",
        detalle: [
          {
            codigoMoneda: "USD",
            descripcion: "DOLAR E.E.U.U.",
            tipoPase: 0,
            tipoCotizacion: 361.1,
          },
        ],
      },
    ],
  };

  it("extracts the USD quote and sorts ascending by date", () => {
    expect(parseBcraResponse(fixture)).toEqual([
      { date: "2023-12-01", rate: 361.1 },
      { date: "2023-12-12", rate: 366.45 },
      { date: "2023-12-15", rate: 801.1 },
    ]);
  });

  it("drops rows with a zero/missing USD quote", () => {
    const withZero = {
      status: 200,
      results: [
        {
          fecha: "2023-12-01",
          detalle: [{ codigoMoneda: "USD", tipoCotizacion: 0 }],
        },
        {
          fecha: "2023-12-02",
          detalle: [{ codigoMoneda: "ARS", tipoCotizacion: 1 }], // no USD row
        },
      ],
    };
    expect(parseBcraResponse(withZero)).toEqual([]);
  });
});

describe("composeEurArs", () => {
  it("multiplies USD→ARS by the nearest-on-or-before EUR→USD rate", () => {
    const eurUsd: RatePoint[] = [
      { date: "2023-12-01", rate: 1.0875 },
      { date: "2023-12-08", rate: 1.0777 },
    ];
    const usdArs: RatePoint[] = [
      { date: "2023-12-01", rate: 361.1 }, // exact match
      { date: "2023-12-05", rate: 363.1 }, // falls back to 12-01 rate
    ];
    const composed = composeEurArs(eurUsd, usdArs);
    expect(composed).toEqual([
      { date: "2023-12-01", rate: 361.1 * 1.0875 },
      { date: "2023-12-05", rate: 363.1 * 1.0875 },
    ]);
  });

  it("drops USD→ARS points earlier than the first EUR→USD quote", () => {
    const eurUsd: RatePoint[] = [{ date: "2024-01-01", rate: 1.1 }];
    const usdArs: RatePoint[] = [{ date: "2023-12-01", rate: 361.1 }];
    expect(composeEurArs(eurUsd, usdArs)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fxratesapi.com parsing — canned fixtures matching the real API shape
// ---------------------------------------------------------------------------

describe("parseFxratesapiHistorical", () => {
  it("extracts the requested currency's rate for the date", () => {
    const body = {
      success: true,
      date: "2024-01-01T23:59:00.000Z",
      rates: { ARS: 892.41, PYG: 8056.21, USD: 1.1037 },
    };
    expect(parseFxratesapiHistorical(body, "PYG")).toEqual({
      date: "2024-01-01",
      rate: 8056.21,
    });
  });

  it("returns null on failure or missing currency", () => {
    expect(
      parseFxratesapiHistorical(
        { success: false, date: "2024-01-01T23:59:00.000Z", rates: {} },
        "PYG",
      ),
    ).toBeNull();
    expect(
      parseFxratesapiHistorical(
        { success: true, date: "2024-01-01T23:59:00.000Z", rates: { USD: 1.1 } },
        "PYG",
      ),
    ).toBeNull();
  });
});

describe("parseFxratesapiTimeseries", () => {
  it("extracts sorted rate points keyed by date (stripped of the time component)", () => {
    const body = {
      success: true,
      rates: {
        "2025-09-09T23:59:00.000Z": { PYG: 8454.44, ARS: 1657.9 },
        "2025-09-01T23:59:00.000Z": { PYG: 8467.05, ARS: 1612.14 },
      },
    };
    expect(parseFxratesapiTimeseries(body, "PYG")).toEqual([
      { date: "2025-09-01", rate: 8467.05 },
      { date: "2025-09-09", rate: 8454.44 },
    ]);
  });

  it("returns an empty array on failure", () => {
    expect(parseFxratesapiTimeseries({ success: false, rates: {} }, "PYG")).toEqual(
      [],
    );
  });
});

describe("planPygFetch", () => {
  it("uses only the dense bulk range when the whole request fits within it", () => {
    const plan = planPygFetch("2025-09-01", "2025-09-10", "2026-08-08");
    expect(plan.dense).toEqual(["2025-09-01", "2025-09-10"]);
    expect(plan.sparseDates).toEqual([]);
  });

  it("splits into a sparse older range and a dense recent range", () => {
    const today = "2026-08-08";
    const plan = planPygFetch("2023-12-01", today, today, 365, 7);
    // dense range = last 365 days
    expect(plan.dense).toEqual([addDaysHelper(today, -365), today]);
    // sparse range covers 2023-12-01 up to the day before the dense cutoff
    expect(plan.sparseDates[0]).toBe("2023-12-01");
    expect(plan.sparseDates[plan.sparseDates.length - 1]).toBe(
      addDaysHelper(addDaysHelper(today, -365), -1),
    );
    // steps are (mostly) 7 days apart
    for (let i = 1; i < plan.sparseDates.length - 1; i++) {
      expect(daysBetween(plan.sparseDates[i - 1], plan.sparseDates[i])).toBe(7);
    }
  });

  it("returns no dense range and no sparse dates for an empty/invalid window", () => {
    const plan = planPygFetch("2026-08-08", "2026-08-01", "2026-08-08");
    expect(plan.dense).toBeNull();
    expect(plan.sparseDates).toEqual([]);
  });

  function addDaysHelper(date: string, days: number): string {
    return addDays(date, days);
  }
});

// ---------------------------------------------------------------------------
// Stats / DB row shaping
// ---------------------------------------------------------------------------

describe("computeStats", () => {
  it("returns null for an empty series", () => {
    expect(computeStats([])).toBeNull();
  });

  it("computes count, coverage, largest gap, and min/max rate", () => {
    const points: RatePoint[] = [
      { date: "2024-01-01", rate: 1.05 },
      { date: "2024-01-02", rate: 1.1 },
      { date: "2024-01-10", rate: 1.02 },
    ];
    expect(computeStats(points)).toEqual({
      count: 3,
      firstDate: "2024-01-01",
      lastDate: "2024-01-10",
      maxGapDays: 8,
      minRate: 1.02,
      maxRate: 1.1,
    });
  });
});

describe("toDbRows", () => {
  it("shapes points into fx_rates rows pivoted on EUR with an 8-decimal rate string", () => {
    expect(toDbRows("USD", [{ date: "2024-01-01", rate: 1.0956 }])).toEqual([
      {
        date: "2024-01-01",
        fromCurrency: "EUR",
        toCurrency: "USD",
        rate: "1.09560000",
      },
    ]);
  });
});
