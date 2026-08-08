// Money math on integer minor units ("cents"). Amounts cross the API boundary
// as numeric strings ("1234.56") matching Postgres numeric(14,2); inside app
// code they are integers to keep arithmetic exact.
//
// PYG (and a few others) have 0 decimal places — minor units == whole units.

const ZERO_DECIMAL_CURRENCIES = new Set(["PYG", "JPY", "KRW", "VND", "CLP"]);

export function decimalsFor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

/** "1234.56" | "1.234,56" | 1234.56 → integer minor units. Throws on garbage. */
export function toCents(value: string | number, currency = "EUR"): number {
  const decimals = decimalsFor(currency);
  let normalized: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${value}`);
    normalized = value.toFixed(decimals);
  } else {
    normalized = value.trim();
    // "1.234,56" (comma-decimal) → "1234.56"
    if (/^-?[\d.]+,\d+$/.test(normalized)) {
      normalized = normalized.replaceAll(".", "").replace(",", ".");
    } else {
      normalized = normalized.replaceAll(",", "");
    }
    if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
      throw new Error(`Invalid amount: ${value}`);
    }
  }
  const [whole, frac = ""] = normalized.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const sign = whole.startsWith("-") ? -1 : 1;
  const wholeAbs = whole.replace("-", "") || "0";
  const cents =
    Number(wholeAbs) * 10 ** decimals + (decimals > 0 ? Number(fracPadded) : 0);
  if (!Number.isSafeInteger(cents)) throw new Error(`Amount overflow: ${value}`);
  return sign * cents;
}

/** Integer minor units → "1234.56" (DB/API numeric string). */
export function centsToDecimalString(cents: number, currency = "EUR"): string {
  const decimals = decimalsFor(currency);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  if (decimals === 0) return `${sign}${abs}`;
  const whole = Math.floor(abs / 10 ** decimals);
  const frac = String(abs % 10 ** decimals).padStart(decimals, "0");
  return `${sign}${whole}.${frac}`;
}

/** Convert minor units between currencies at a given rate (round half away from zero). */
export function convertCents(
  cents: number,
  rate: number,
  fromCurrency: string,
  toCurrency: string,
): number {
  const fromDec = decimalsFor(fromCurrency);
  const toDec = decimalsFor(toCurrency);
  const major = cents / 10 ** fromDec;
  const converted = major * rate * 10 ** toDec;
  return Math.sign(converted) * Math.round(Math.abs(converted));
}

/** Format minor units for display, e.g. 123456 → "€1,234.56". */
export function formatCents(
  cents: number,
  currency: string,
  locale = "en-GB",
): string {
  const decimals = decimalsFor(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(cents / 10 ** decimals);
}
