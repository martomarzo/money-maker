"use server";

// Bank-import server actions (Phase 1.5). Consumes the pure engine in
// src/lib/import/ (parsing, draft building, dedupe, transfer matching,
// category suggestion) and owns all I/O: reading extracted statement JSON
// off disk, and reading/writing the household's accounts/transactions/
// import_batches. See plan.md and CLAUDE.md for the design.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { accounts, categories, importBatches, transactions } from "@/db/schema";
import { centsToDecimalString, toCents } from "@/lib/domain/money";
import { getRate } from "@/lib/fx";
import {
  draftsFromStatement,
  findInBatchDuplicates,
  matchTransferLegs,
  normalizeMatchText,
  suggestCategory,
  type CategoryRule,
  type TransactionDraft,
} from "@/lib/import/engine";
import { listExtractedFiles, loadExtractedStatement } from "@/lib/import/load";
import type { AccountHint } from "@/lib/import/types";
import { listCategories, listCategoryRules } from "@/lib/queries";
import { requireUser, requireUserId } from "@/lib/session";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Resolve a user-supplied filename to a real path under the extracted-JSON
 *  dir, using only paths listExtractedFiles() itself returned (no
 *  traversal possible — the filename must match a basename we already
 *  enumerated from disk). */
async function resolveStatementPath(filename: string): Promise<string | null> {
  const files = await listExtractedFiles();
  return files.find((f) => path.basename(f) === filename) ?? null;
}

function sourceToken(source: string): string {
  return source.split("_")[0] ?? source;
}

function stripParenthetical(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function proposedNewName(hint: AccountHint, currency: string, multiCurrency: boolean): string {
  if (!multiCurrency) return hint.name;
  return `${stripParenthetical(hint.name)} ${currency}`;
}

// ---------------------------------------------------------------------------
// listStatementSummaries
// ---------------------------------------------------------------------------

export interface StatementSummary {
  filename: string;
  source: string;
  sourceFile: string;
  accountHint: AccountHint;
  currencies: string[];
  rowCount: number;
  dateFrom: string | null;
  dateTo: string | null;
  warnings: string[];
  status: "new" | "partial" | "imported";
  latestBatch: {
    id: string;
    createdAt: Date;
    importedCount: number;
    skippedDuplicateCount: number;
    skippedFilteredCount: number;
  } | null;
}

/** One row per extracted-statement file, with the household's latest import
 *  status for it (a file can have been committed more than once — the
 *  partial unique index on source_hash makes re-commits idempotent, and we
 *  only look at the most recent batch here). */
export async function listStatementSummaries(): Promise<StatementSummary[]> {
  const userId = await requireUserId();
  const files = await listExtractedFiles();

  const statements = await Promise.all(
    files.map(async (filePath) => ({
      filename: path.basename(filePath),
      stmt: await loadExtractedStatement(filePath),
    })),
  );

  const shas = [...new Set(statements.map(({ stmt }) => stmt.file_sha256))];
  const batches = shas.length
    ? await db.query.importBatches.findMany({
        where: and(eq(importBatches.userId, userId), inArray(importBatches.fileSha256, shas)),
        orderBy: [desc(importBatches.createdAt)],
      })
    : [];
  const latestByHash = new Map<string, (typeof batches)[number]>();
  for (const b of batches) {
    if (!latestByHash.has(b.fileSha256)) latestByHash.set(b.fileSha256, b);
  }

  const summaries: StatementSummary[] = statements.map(({ filename, stmt }) => {
    const { currencies } = draftsFromStatement(stmt);
    const dates = stmt.rows.map((r) => r.date).sort();
    const latest = latestByHash.get(stmt.file_sha256) ?? null;
    const total = stmt.rows.length;
    const accountedFor = latest
      ? latest.importedCount + latest.skippedDuplicateCount + latest.skippedFilteredCount
      : 0;
    const status: StatementSummary["status"] =
      !latest || accountedFor === 0
        ? "new"
        : accountedFor >= total
          ? "imported"
          : "partial";

    return {
      filename,
      source: stmt.source,
      sourceFile: stmt.source_file,
      accountHint: stmt.account_hint,
      currencies,
      rowCount: total,
      dateFrom: dates[0] ?? null,
      dateTo: dates[dates.length - 1] ?? null,
      warnings: stmt.warnings,
      status,
      latestBatch: latest
        ? {
            id: latest.id,
            createdAt: latest.createdAt,
            importedCount: latest.importedCount,
            skippedDuplicateCount: latest.skippedDuplicateCount,
            skippedFilteredCount: latest.skippedFilteredCount,
          }
        : null,
    };
  });

  summaries.sort(
    (a, b) => a.source.localeCompare(b.source) || a.filename.localeCompare(b.filename),
  );
  return summaries;
}

export interface RecentImportBatch {
  id: string;
  filename: string;
  source: string;
  createdAt: Date;
  importedCount: number;
  skippedDuplicateCount: number;
  skippedFilteredCount: number;
}

/** Most recent committed batches for the household, for the /import page's
 *  history list (with Undo buttons). */
export async function listRecentImportBatches(limit = 20): Promise<RecentImportBatch[]> {
  const userId = await requireUserId();
  const rows = await db.query.importBatches.findMany({
    where: eq(importBatches.userId, userId),
    orderBy: [desc(importBatches.createdAt)],
    limit,
  });
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    source: r.source,
    createdAt: r.createdAt,
    importedCount: r.importedCount,
    skippedDuplicateCount: r.skippedDuplicateCount,
    skippedFilteredCount: r.skippedFilteredCount,
  }));
}

// ---------------------------------------------------------------------------
// previewStatement
// ---------------------------------------------------------------------------

export interface AccountProposal {
  currency: string;
  kind: "existing" | "new";
  accountId: string | null;
  accountName: string | null;
  proposedName: string | null;
  proposedType: AccountHint["type"] | null;
}

export interface PreviewDraft extends TransactionDraft {
  alreadyImported: boolean;
  inBatchDuplicate: boolean;
  transferMatchIndex: number | null;
  suggestedCategoryId: string | null;
}

export interface StatementPreview {
  filename: string;
  source: string;
  sourceFile: string;
  accountHint: AccountHint;
  warnings: string[];
  dateFrom: string | null;
  dateTo: string | null;
  currencies: string[];
  accountProposals: AccountProposal[];
  /** All non-archived household accounts matching each currency present in
   *  the statement, for the mapping <select> (accountProposals only carries
   *  the single best fuzzy match). */
  existingAccountsByCurrency: Record<string, Array<{ id: string; name: string }>>;
  drafts: PreviewDraft[];
  categories: Array<{ id: string; parentId: string | null; name: string; icon: string | null }>;
  summary: {
    expenseCount: number;
    incomeCount: number;
    transferCount: number;
    alreadyImportedCount: number;
    inBatchDuplicateCount: number;
    transferMatchedPairs: number;
    suggestedCategoryCount: number;
  };
}

/** Everything the preview page needs for one statement file: draft
 *  transactions grouped implicitly by currency, a proposed account per
 *  currency (existing fuzzy-matched or "create new"), dedupe flags (in-batch
 *  and vs-DB), transfer-leg matches within the statement, and category
 *  suggestions. Returns null when the filename doesn't match a real
 *  extracted file. */
export async function previewStatement(filename: string): Promise<StatementPreview | null> {
  const userId = await requireUserId();

  const filePath = await resolveStatementPath(filename);
  if (!filePath) return null;

  const stmt = await loadExtractedStatement(filePath);
  const { drafts, currencies } = draftsFromStatement(stmt);
  const multiCurrency = currencies.length > 1;

  const [allUserAccounts, ruleRows, categoryRows] = await Promise.all([
    db.query.accounts.findMany({
      where: and(eq(accounts.userId, userId), isNull(accounts.deletedAt)),
    }),
    listCategoryRules(userId),
    listCategories(userId),
  ]);
  const householdAccounts = allUserAccounts.filter((a) => !a.archived);
  const rules: CategoryRule[] = ruleRows.map((r) => r.rule);

  const matchTokens = [
    normalizeMatchText(sourceToken(stmt.source)),
    normalizeMatchText(stripParenthetical(stmt.account_hint.name)),
  ].filter((t) => t.length >= 3);

  const accountProposals: AccountProposal[] = currencies.map((currency): AccountProposal => {
    const existing = householdAccounts.find((a) => {
      if (a.currency.trim() !== currency) return false;
      const nameNorm = normalizeMatchText(a.name);
      return matchTokens.some((t) => nameNorm.includes(t));
    });
    if (existing) {
      return {
        currency,
        kind: "existing",
        accountId: existing.id,
        accountName: existing.name,
        proposedName: null,
        proposedType: null,
      };
    }
    return {
      currency,
      kind: "new",
      accountId: null,
      accountName: null,
      proposedName: proposedNewName(stmt.account_hint, currency, multiCurrency),
      proposedType: stmt.account_hint.type,
    };
  });

  const inBatchDupSet = new Set(findInBatchDuplicates(drafts));

  // vs-DB duplicates: for each currency group mapped to an *existing*
  // account, look up which of this batch's source hashes already exist
  // there. New-account groups can't have DB duplicates yet.
  const alreadyImportedHashes = new Set<string>();
  for (const proposal of accountProposals) {
    if (proposal.kind !== "existing" || !proposal.accountId) continue;
    const hashes = [
      ...new Set(
        drafts
          .filter((d) => d.currency === proposal.currency && d.sourceHash)
          .map((d) => d.sourceHash as string),
      ),
    ];
    if (hashes.length === 0) continue;
    const existingRows = await db
      .select({ sourceHash: transactions.sourceHash })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, proposal.accountId),
          inArray(transactions.sourceHash, hashes),
          isNull(transactions.deletedAt),
        ),
      );
    for (const row of existingRows) {
      if (row.sourceHash) alreadyImportedHashes.add(`${proposal.currency}::${row.sourceHash}`);
    }
  }

  const entries = drafts.map((d) => ({ draft: d, accountKey: d.currency }));
  const pairs = matchTransferLegs(entries);
  const transferMatchByIndex = new Map<number, number>();
  for (const [i, j] of pairs) {
    transferMatchByIndex.set(i, j);
    transferMatchByIndex.set(j, i);
  }

  let expenseCount = 0;
  let incomeCount = 0;
  let transferCount = 0;
  let suggestedCategoryCount = 0;

  const previewDrafts: PreviewDraft[] = drafts.map((draft): PreviewDraft => {
    if (draft.type === "expense") expenseCount++;
    else if (draft.type === "income") incomeCount++;
    else transferCount++;

    const alreadyImported = draft.sourceHash
      ? alreadyImportedHashes.has(`${draft.currency}::${draft.sourceHash}`)
      : false;

    const matchedProposal = accountProposals.find((p) => p.currency === draft.currency);
    const suggestedCategoryId = suggestCategory(
      draft,
      rules,
      matchedProposal?.kind === "existing" && matchedProposal.accountId
        ? matchedProposal.accountId
        : undefined,
    );
    if (suggestedCategoryId) suggestedCategoryCount++;

    return {
      ...draft,
      alreadyImported,
      inBatchDuplicate: inBatchDupSet.has(draft.index),
      transferMatchIndex: transferMatchByIndex.get(draft.index) ?? null,
      suggestedCategoryId,
    };
  });

  const dates = stmt.rows.map((r) => r.date).sort();

  return {
    filename,
    source: stmt.source,
    sourceFile: stmt.source_file,
    accountHint: stmt.account_hint,
    warnings: stmt.warnings,
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null,
    currencies,
    accountProposals,
    existingAccountsByCurrency: Object.fromEntries(
      currencies.map((currency) => [
        currency,
        householdAccounts
          .filter((a) => a.currency.trim() === currency)
          .map((a) => ({ id: a.id, name: a.name })),
      ]),
    ),
    drafts: previewDrafts,
    categories: categoryRows.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      name: c.name,
      icon: c.icon,
    })),
    summary: {
      expenseCount,
      incomeCount,
      transferCount,
      alreadyImportedCount: previewDrafts.filter((d) => d.alreadyImported).length,
      inBatchDuplicateCount: inBatchDupSet.size,
      transferMatchedPairs: pairs.length,
      suggestedCategoryCount,
    },
  };
}

// ---------------------------------------------------------------------------
// commitStatement
// ---------------------------------------------------------------------------

const accountChoiceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), accountId: z.uuid() }),
  z.object({
    mode: z.literal("new"),
    name: z.string().min(1, "Give the account a name").max(80),
    type: z.enum(["checking", "savings", "cash", "credit_card"]),
  }),
]);

const commitSchema = z.object({
  filename: z.string().min(1),
  // Keyed by currency code, e.g. { "ARS": { mode: "existing", accountId }, "USD": { mode: "new", ... } }
  accountChoices: z.record(z.string(), accountChoiceSchema),
  excludedIndices: z.array(z.number().int().nonnegative()),
  // Keyed by draft index (as a string, since it comes through JSON): categoryId or null (explicit uncategorized).
  categoryOverrides: z.record(z.string(), z.uuid().nullable()),
});

function parseJsonField<T>(formData: FormData, key: string, fallback: T): T {
  const raw = formData.get(key);
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export type CommitStatementResult =
  | {
      ok: true;
      batchId: string;
      importedCount: number;
      skippedDuplicateCount: number;
      skippedFilteredCount: number;
      transfersLinked: number;
      unlinkedTransfersMatched: number;
    }
  | { ok: false; error: string };

/** Commits a previewed statement: creates any inline "new account" choices,
 *  records an import_batches row, inserts transactions (idempotent via
 *  ON CONFLICT DO NOTHING on the partial (account_id, source_hash) unique
 *  index — re-committing the same file only inserts genuinely new rows),
 *  and links transfer legs matched within this batch. Finishes with a
 *  household-wide unlinked-transfer sweep. */
export async function commitStatement(
  _prev: CommitStatementResult | null,
  formData: FormData,
): Promise<CommitStatementResult> {
  const { userId, baseCurrency } = await requireUser();

  const parsed = commitSchema.safeParse({
    filename: formData.get("filename"),
    accountChoices: parseJsonField(formData, "accountChoices", {}),
    excludedIndices: parseJsonField(formData, "excludedIndices", []),
    categoryOverrides: parseJsonField(formData, "categoryOverrides", {}),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { filename, accountChoices, excludedIndices, categoryOverrides } = parsed.data;

  const filePath = await resolveStatementPath(filename);
  if (!filePath) return { ok: false, error: "Statement file not found" };

  const stmt = await loadExtractedStatement(filePath);
  const { drafts, currencies } = draftsFromStatement(stmt);

  for (const currency of currencies) {
    if (!accountChoices[currency]) {
      return { ok: false, error: `Missing account mapping for ${currency}` };
    }
  }

  // Validate "existing account" choices belong to the user and match currency.
  for (const currency of currencies) {
    const choice = accountChoices[currency];
    if (choice.mode !== "existing") continue;
    const account = await db.query.accounts.findFirst({
      where: and(
        eq(accounts.id, choice.accountId),
        eq(accounts.userId, userId),
        isNull(accounts.deletedAt),
      ),
    });
    if (!account) return { ok: false, error: "Selected account not found" };
    if (account.currency.trim() !== currency) {
      return { ok: false, error: `Account currency does not match ${currency}` };
    }
  }

  // Validate category overrides belong to the user.
  const overrideCategoryIds = [
    ...new Set(Object.values(categoryOverrides).filter((v): v is string => Boolean(v))),
  ];
  if (overrideCategoryIds.length > 0) {
    const validCategories = await db.query.categories.findMany({
      where: and(
        inArray(categories.id, overrideCategoryIds),
        eq(categories.userId, userId),
        isNull(categories.deletedAt),
      ),
    });
    if (validCategories.length !== overrideCategoryIds.length) {
      return { ok: false, error: "Invalid category selected" };
    }
  }

  const excludedSet = new Set(excludedIndices);
  const includedDrafts = drafts.filter((d) => !excludedSet.has(d.index));
  if (includedDrafts.length === 0) {
    return { ok: false, error: "No rows selected to import" };
  }

  const ruleRows = await listCategoryRules(userId);
  const rules: CategoryRule[] = ruleRows.map((r) => r.rule);

  // FX lookups repeat heavily across a statement (many rows share a date) —
  // cache within this commit to avoid redundant queries.
  const rateCache = new Map<string, Promise<number | null>>();
  function cachedRate(date: string, from: string, to: string): Promise<number | null> {
    const key = `${date}|${from}|${to}`;
    let entry = rateCache.get(key);
    if (!entry) {
      entry = getRate(date, from, to);
      rateCache.set(key, entry);
    }
    return entry;
  }

  const includedDates = includedDrafts.map((d) => d.date).sort();
  const dateFrom = includedDates[0] ?? null;
  const dateTo = includedDates[includedDates.length - 1] ?? null;

  const committed = await db.transaction(async (tx) => {
    // 1. Create inline accounts for "new" choices.
    const accountIdByCurrency = new Map<string, string>();
    for (const currency of currencies) {
      const choice = accountChoices[currency];
      if (choice.mode === "existing") {
        accountIdByCurrency.set(currency, choice.accountId);
        continue;
      }
      const [created] = await tx
        .insert(accounts)
        .values({
          userId,
          name: choice.name,
          type: choice.type,
          currency,
          initialBalance: "0",
        })
        .returning({ id: accounts.id });
      accountIdByCurrency.set(currency, created.id);
    }

    // 2. Insert the import batch row (counts filled in after step 3).
    const [batch] = await tx
      .insert(importBatches)
      .values({
        userId,
        accountId: currencies.length === 1 ? (accountIdByCurrency.get(currencies[0]) ?? null) : null,
        source: stmt.source,
        filename,
        fileSha256: stmt.file_sha256,
        dateFrom,
        dateTo,
        createdByUserId: userId,
      })
      .returning({ id: importBatches.id });
    const batchId = batch.id;

    // 3. Insert transactions. Client-generated ids let us tell which drafts
    // actually landed (onConflictDoNothing silently skips DB-level dupes;
    // ids aren't part of the conflict target, so RETURNING tells us exactly
    // which rows were inserted vs skipped).
    const draftIndexToId = new Map<number, string>();
    const insertValues = [];
    for (const draft of includedDrafts) {
      const id = randomUUID();
      draftIndexToId.set(draft.index, id);
      const accountId = accountIdByCurrency.get(draft.currency);
      if (!accountId) throw new Error(`No account resolved for currency ${draft.currency}`);

      const key = String(draft.index);
      const hasOverride = Object.prototype.hasOwnProperty.call(categoryOverrides, key);
      const categoryId = hasOverride
        ? categoryOverrides[key]
        : suggestCategory(draft, rules, accountId);

      const rate = await cachedRate(draft.date, draft.currency, baseCurrency);

      insertValues.push({
        id,
        userId,
        accountId,
        createdByUserId: userId,
        type: draft.type,
        amount: centsToDecimalString(draft.amountCents, draft.currency),
        currency: draft.currency,
        date: draft.date,
        categoryId,
        payee: draft.payee.length > 0 ? draft.payee : null,
        notes: draft.notes,
        fxRateToBase: rate == null ? null : rate.toFixed(8),
        sourceHash: draft.sourceHash,
        importBatchId: batchId,
        originalAmount:
          draft.originalAmountCents != null && draft.originalCurrency
            ? centsToDecimalString(draft.originalAmountCents, draft.originalCurrency)
            : null,
        originalCurrency: draft.originalCurrency,
      });
    }

    const inserted = await tx
      .insert(transactions)
      .values(insertValues)
      .onConflictDoNothing({
        target: [transactions.accountId, transactions.sourceHash],
        where: sql`${transactions.sourceHash} is not null`,
      })
      .returning({ id: transactions.id });

    const insertedIds = new Set(inserted.map((r) => r.id));
    const idToDraftIndex = new Map<string, number>();
    for (const [index, id] of draftIndexToId) idToDraftIndex.set(id, index);
    const insertedIndices = new Set<number>();
    for (const id of insertedIds) {
      const index = idToDraftIndex.get(id);
      if (index !== undefined) insertedIndices.add(index);
    }

    const importedCount = insertedIndices.size;
    const skippedDuplicateCount = includedDrafts.length - importedCount;
    const skippedFilteredCount = excludedSet.size;

    // 4. Link transfer legs matched within this statement, only when both
    // legs actually landed as new rows.
    const entries = drafts.map((d) => ({ draft: d, accountKey: d.currency }));
    const pairs = matchTransferLegs(entries);
    let transfersLinked = 0;
    for (const [i, j] of pairs) {
      if (!insertedIndices.has(i) || !insertedIndices.has(j)) continue;
      const idI = draftIndexToId.get(i);
      const idJ = draftIndexToId.get(j);
      if (!idI || !idJ) continue;
      await tx.update(transactions).set({ transferPeerId: idJ }).where(eq(transactions.id, idI));
      await tx.update(transactions).set({ transferPeerId: idI }).where(eq(transactions.id, idJ));
      transfersLinked++;
    }

    await tx
      .update(importBatches)
      .set({ importedCount, skippedDuplicateCount, skippedFilteredCount })
      .where(eq(importBatches.id, batchId));

    return { batchId, importedCount, skippedDuplicateCount, skippedFilteredCount, transfersLinked };
  });

  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/import");

  const unlinked = await matchUnlinkedTransfers();

  return {
    ok: true,
    ...committed,
    unlinkedTransfersMatched: unlinked.ok ? unlinked.linked : 0,
  };
}

// ---------------------------------------------------------------------------
// matchUnlinkedTransfers
// ---------------------------------------------------------------------------

export type MatchTransfersResult = { ok: true; linked: number } | { ok: false; error: string };

/** Household-wide pass over non-deleted transfer rows with no peer linked
 *  yet: pairs them by opposite sign, same currency, equal |amount|, and
 *  dates within 3 days (reusing the engine's matcher with accountKey =
 *  accountId). Cross-currency pairs are intentionally skipped here — the
 *  engine's cross-currency branch requires kind "exchange" on both legs,
 *  which isn't stored on committed transactions, so this only ever matches
 *  same-currency transfers. */
export async function matchUnlinkedTransfers(): Promise<MatchTransfersResult> {
  const userId = await requireUserId();

  const rows = await db.query.transactions.findMany({
    where: and(
      eq(transactions.userId, userId),
      eq(transactions.type, "transfer"),
      isNull(transactions.transferPeerId),
      isNull(transactions.deletedAt),
    ),
  });
  if (rows.length < 2) return { ok: true, linked: 0 };

  const entries = rows.map((row, i) => ({
    draft: {
      index: i,
      date: row.date,
      type: "transfer" as const,
      amountCents: toCents(row.amount, row.currency.trim()),
      currency: row.currency.trim(),
      payee: row.payee ?? "",
      notes: row.notes,
      originalAmountCents: null,
      originalCurrency: null,
      sourceHash: row.sourceHash,
      kind: "transfer" as const,
    },
    accountKey: row.accountId,
  }));

  const pairs = matchTransferLegs(entries);
  if (pairs.length === 0) return { ok: true, linked: 0 };

  const now = new Date();
  await db.transaction(async (tx) => {
    for (const [i, j] of pairs) {
      await tx
        .update(transactions)
        .set({ transferPeerId: rows[j].id, updatedAt: now })
        .where(eq(transactions.id, rows[i].id));
      await tx
        .update(transactions)
        .set({ transferPeerId: rows[i].id, updatedAt: now })
        .where(eq(transactions.id, rows[j].id));
    }
  });

  revalidatePath("/transactions");
  revalidatePath("/import");

  return { ok: true, linked: pairs.length };
}

// ---------------------------------------------------------------------------
// undoImportBatch
// ---------------------------------------------------------------------------

export type UndoImportResult = { ok: true; count: number } | { ok: false; error: string };

/** Soft-deletes every non-deleted transaction from a batch (keeping the
 *  batch row itself as history) and clears transferPeerId on any surviving
 *  rows (in other batches, or matched by matchUnlinkedTransfers) that
 *  pointed at the deleted rows. */
export async function undoImportBatch(batchId: string): Promise<UndoImportResult> {
  const userId = await requireUserId();

  const batch = await db.query.importBatches.findFirst({
    where: and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)),
  });
  if (!batch) return { ok: false, error: "Import batch not found" };

  const count = await db.transaction(async (tx) => {
    const toDelete = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.importBatchId, batchId),
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
        ),
      );
    if (toDelete.length === 0) return 0;
    const deletedIds = toDelete.map((r) => r.id);

    const now = new Date();
    // source_hash is cleared so the partial unique index (which does NOT
    // exclude soft-deleted rows) can't block re-importing this file later.
    await tx
      .update(transactions)
      .set({ deletedAt: now, updatedAt: now, sourceHash: null })
      .where(inArray(transactions.id, deletedIds));

    // Peers outside this batch (or matched later by matchUnlinkedTransfers)
    // that still point at a now-deleted row.
    await tx
      .update(transactions)
      .set({ transferPeerId: null, updatedAt: now })
      .where(
        and(
          eq(transactions.userId, userId),
          inArray(transactions.transferPeerId, deletedIds),
          isNull(transactions.deletedAt),
        ),
      );

    return deletedIds.length;
  });

  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/import");

  return { ok: true, count };
}
