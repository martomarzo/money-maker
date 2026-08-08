// Pure transformation logic for bank-statement imports (Phase 1.5). No fs,
// no db — takes an already-parsed ExtractedStatement (see types.ts) and
// produces draft transactions, in-batch dedupe hints, transfer-leg pairings,
// and category suggestions. Callers (server actions, UI) own I/O.

import type { ExtractedRow, ExtractedStatement } from "./types";

export type DraftType = "expense" | "income" | "transfer";

export interface TransactionDraft {
  index: number;
  date: string;
  type: DraftType;
  // Positive for expense/income (abs of amount_minor); signed for transfer
  // legs (negative = outflow), matching transactions.amount's convention.
  amountCents: number;
  currency: string;
  payee: string;
  notes: string | null;
  originalAmountCents: number | null;
  originalCurrency: string | null;
  sourceHash: string | null;
  kind: ExtractedRow["kind"];
}

/** kind → transaction type. FINAL mapping — do not change without updating
 *  the extraction pipeline's contract too. */
function typeForKind(kind: ExtractedRow["kind"], amountMinor: number): DraftType {
  switch (kind) {
    case "purchase":
    case "fee":
    case "tax":
      return "expense";
    case "income":
    case "refund":
      return "income";
    case "transfer":
    case "exchange":
    case "payment":
      return "transfer";
    case "unknown":
      return amountMinor < 0 ? "expense" : "income";
  }
}

function buildNotes(row: ExtractedRow): string | null {
  const parts: string[] = [];
  if (row.cardholder) parts.push(`Cardholder: ${row.cardholder}`);
  if (row.place === "exterior") parts.push("Foreign purchase");
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Build a single transaction draft from one row of an extracted statement.
 *  `index` is the row's position in `stmt.rows` — carried through so callers
 *  can correlate drafts back to their source row (preview UIs, dedupe). */
export function draftFromRow(row: ExtractedRow, index: number): TransactionDraft {
  const type = typeForKind(row.kind, row.amount_minor);
  const amountCents = type === "transfer" ? row.amount_minor : Math.abs(row.amount_minor);
  const payee = (row.merchant ?? row.description).trim();

  return {
    index,
    date: row.date,
    type,
    amountCents,
    currency: row.currency,
    payee,
    notes: buildNotes(row),
    originalAmountCents: row.original_amount_minor,
    originalCurrency: row.original_currency,
    sourceHash: row.extra.dedupe_key ?? null,
    kind: row.kind,
  };
}

export interface DraftsFromStatementResult {
  drafts: TransactionDraft[];
  /** Distinct currencies present in `rows`, in order of first appearance.
   *  Statements can mix currencies (Santander ARS+USD from one file) — each
   *  currency maps to a different app account. */
  currencies: string[];
}

export function draftsFromStatement(stmt: ExtractedStatement): DraftsFromStatementResult {
  const drafts = stmt.rows.map((row, index) => draftFromRow(row, index));
  const currencies: string[] = [];
  for (const row of stmt.rows) {
    if (!currencies.includes(row.currency)) currencies.push(row.currency);
  }
  return { drafts, currencies };
}

/** Indices of drafts whose sourceHash repeats within the same currency
 *  bucket (i.e. would collide on the same app account's source_hash unique
 *  index). Drafts with a null sourceHash are never flagged. The FIRST
 *  occurrence of a repeated hash is included too — all members of the
 *  duplicate group are returned, not just the later ones. */
export function findInBatchDuplicates(drafts: TransactionDraft[]): number[] {
  const groups = new Map<string, number[]>();
  for (const draft of drafts) {
    if (!draft.sourceHash) continue;
    const key = `${draft.currency}::${draft.sourceHash}`;
    const group = groups.get(key);
    if (group) group.push(draft.index);
    else groups.set(key, [draft.index]);
  }
  const duplicates: number[] = [];
  for (const group of groups.values()) {
    if (group.length > 1) duplicates.push(...group);
  }
  duplicates.sort((a, b) => a - b);
  return duplicates;
}

export interface TransferLegEntry {
  draft: TransactionDraft;
  accountKey: string;
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(a) - Date.parse(b));
  return ms / (1000 * 60 * 60 * 24);
}

/** Greedily pair transfer-type drafts across different accounts:
 *  - same currency: opposite-signed, equal |amount|, dates within 3 days
 *    (closest date preferred among candidates)
 *  - cross-currency: only when both legs are kind "exchange" and dates are
 *    equal (same-day currency conversion, e.g. Revolut/Wise)
 *  Each entry pairs at most once. Returns pairs as indices into `entries`.
 *  Unmatched legs are simply omitted — that's an expected outcome, not an
 *  error. */
export function matchTransferLegs(entries: TransferLegEntry[]): Array<[number, number]> {
  const candidates = entries
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry.draft.type === "transfer");

  type ScoredPair = { i: number; j: number; score: number };
  const pairs: ScoredPair[] = [];

  for (let a = 0; a < candidates.length; a++) {
    for (let b = a + 1; b < candidates.length; b++) {
      const { entry: e1, i: i1 } = candidates[a];
      const { entry: e2, i: i2 } = candidates[b];
      if (e1.accountKey === e2.accountKey) continue;

      const d1 = e1.draft;
      const d2 = e2.draft;
      // Opposite signs (one outflow, one inflow) — same sign can't be a pair.
      if (Math.sign(d1.amountCents) === Math.sign(d2.amountCents)) continue;
      if (d1.amountCents === 0 || d2.amountCents === 0) continue;

      if (d1.currency === d2.currency) {
        if (Math.abs(d1.amountCents) !== Math.abs(d2.amountCents)) continue;
        const gap = daysBetween(d1.date, d2.date);
        if (gap > 3) continue;
        // Closer dates score better (lower gap = higher priority).
        pairs.push({ i: i1, j: i2, score: gap });
      } else {
        if (d1.kind !== "exchange" || d2.kind !== "exchange") continue;
        if (d1.date !== d2.date) continue;
        pairs.push({ i: i1, j: i2, score: 0 });
      }
    }
  }

  // Greedy: best (lowest score / closest date) pairs claimed first.
  pairs.sort((a, b) => a.score - b.score);
  const used = new Set<number>();
  const result: Array<[number, number]> = [];
  for (const { i, j } of pairs) {
    if (used.has(i) || used.has(j)) continue;
    used.add(i);
    used.add(j);
    result.push([i, j]);
  }
  return result;
}

/** Lowercase + Unicode-accent-insensitive normalization, for matching
 *  category rules and payee/notes regardless of accents/case
 *  ("Farmacia Iturrieta" ~ "farmacia"). */
export function normalizeMatchText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export interface CategoryRule {
  id: string;
  matchText: string;
  accountId: string | null | undefined;
  currency: string | null | undefined;
  categoryId: string;
  priority: number;
}

/** Suggest a category for a draft from a set of rules (mirrors
 *  category_rules: substring match on normalized payee/notes, optionally
 *  narrowed by currency / accountId, lowest priority number wins, ties
 *  broken by longest matchText). `accountId` is the target account this
 *  draft would be imported into (used to test rule.accountId filters);
 *  omit it to ignore account-scoped rules' account filter (they still only
 *  match when rule.accountId is null). */
export function suggestCategory(
  draft: TransactionDraft,
  rules: CategoryRule[],
  accountId?: string,
): string | null {
  const haystack = normalizeMatchText(
    [draft.payee, draft.notes].filter((v): v is string => Boolean(v)).join(" "),
  );

  const matches = rules.filter((rule) => {
    const needle = normalizeMatchText(rule.matchText);
    if (!needle || !haystack.includes(needle)) return false;
    if (rule.currency && rule.currency !== draft.currency) return false;
    // Account-scoped rules only filter when the caller tells us which
    // account this draft targets; without that, don't exclude them.
    if (accountId !== undefined && rule.accountId && rule.accountId !== accountId) {
      return false;
    }
    return true;
  });

  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.matchText.length - a.matchText.length;
  });

  return matches[0].categoryId;
}
