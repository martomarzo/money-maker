// Household share splits. A shared transaction's full amount is divided among
// the household's members; the default is an even split, the owner may edit.
// All amounts are integer minor units in the transaction's currency.

export interface SplitLine {
  userId: string;
  shareCents: number;
}

/**
 * Even split of `totalCents` across `memberIds` (in the given order). Any
 * remainder cents are handed out one per member starting with the payer, then
 * continuing in member order (wrapping). Currency is accepted for symmetry
 * with the rest of the money API; minor units are already integers.
 */
export function evenSplit(
  totalCents: number,
  _currency: string,
  memberIds: readonly string[],
  payerUserId: string,
): SplitLine[] {
  if (memberIds.length === 0) throw new Error("A split needs at least one member");
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new Error(`Invalid split total: ${totalCents}`);
  }
  const n = memberIds.length;
  const base = Math.floor(totalCents / n);
  let remainder = totalCents - base * n;

  const start = Math.max(0, memberIds.indexOf(payerUserId));
  const lines = memberIds.map((userId) => ({ userId, shareCents: base }));
  for (let i = 0; remainder > 0; i++, remainder--) {
    lines[(start + i) % n].shareCents += 1;
  }
  return lines;
}

export type SplitValidation = { ok: true } | { ok: false; error: string };

/** A split is valid when it is non-empty, has unique members, no negative
 *  lines, and sums exactly to the transaction amount. */
export function validateSplit(totalCents: number, lines: readonly SplitLine[]): SplitValidation {
  if (lines.length === 0) return { ok: false, error: "Split has no members" };
  const seen = new Set<string>();
  let sum = 0;
  for (const line of lines) {
    if (seen.has(line.userId)) return { ok: false, error: "Duplicate member in split" };
    seen.add(line.userId);
    if (!Number.isSafeInteger(line.shareCents) || line.shareCents < 0) {
      return { ok: false, error: "Split amounts must be zero or positive" };
    }
    sum += line.shareCents;
  }
  if (sum !== totalCents) {
    return { ok: false, error: "Split must add up to the transaction amount" };
  }
  return { ok: true };
}
