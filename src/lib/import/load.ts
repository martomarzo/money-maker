// Server-side filesystem loader for extracted statement files (Phase 1.5).
// Kept separate from types.ts/engine.ts so those stay pure/fs-free and
// testable without touching disk.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseExtractedStatement, type ExtractedStatement } from "./types";

const DEFAULT_DIR = () => path.join(process.cwd(), "data", "imports", "extracted");

/** List extracted-statement JSON files in `dir` (default
 *  data/imports/extracted), skipping summary.json, sorted by filename.
 *  Returns an empty list if the directory doesn't exist. */
export async function listExtractedFiles(dir: string = DEFAULT_DIR()): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((name) => name.endsWith(".json") && name !== "summary.json")
    .sort()
    .map((name) => path.join(dir, name));
}

/** Read + parse a single extracted statement file. */
export async function loadExtractedStatement(filePath: string): Promise<ExtractedStatement> {
  const json = await readFile(filePath, "utf-8");
  return parseExtractedStatement(json);
}
