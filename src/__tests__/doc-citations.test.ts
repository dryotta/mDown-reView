import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Meta-test: verify that file:line citations in docs/architecture.md still
 * resolve to existing files, and that range citations (file:NN-MM) point
 * inside the file's actual line count.
 *
 * This is a structural cheap check, NOT semantic — it can't tell you
 * whether the cited block still describes what the doc says, only that
 * the file/line range still exists. It catches drift like "file.ts:300"
 * when file is 200 lines.
 *
 * Tuned to be conservative: a few false negatives (citations we skip)
 * are preferable to false positives (failing on legitimate prose).
 */

const REPO_ROOT = resolve(__dirname, "..", "..");
const ARCHITECTURE_DOC = join(REPO_ROOT, "docs", "architecture.md");

// Paths that are intentionally hypothetical or external in architecture.md.
// Bare basenames listed here are skipped if encountered as citations.
const ALLOWED_MISSING = new Set<string>([
  // none currently — all citations should resolve
]);

// Roots to scan when resolving a bare basename citation.
const SEARCH_ROOTS = ["src", "src-tauri/src"];

// File extensions we accept as code citations.
const CODE_EXT = /\.(?:tsx?|rs|jsx?)$/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "target" || name.startsWith(".")) continue;
    const full = join(dir, name);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) walk(full, out);
    else if (CODE_EXT.test(name)) out.push(full);
  }
  return out;
}

function buildBasenameIndex(): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const root of SEARCH_ROOTS) {
    for (const file of walk(join(REPO_ROOT, root))) {
      const base = file.split(sep).pop()!;
      const arr = idx.get(base) ?? [];
      arr.push(file);
      idx.set(base, arr);
    }
  }
  return idx;
}

function lineCount(file: string): number {
  // Use split-on-newline rather than streaming — files are small.
  const text = readFileSync(file, "utf8");
  // Don't count a trailing empty line from a final newline.
  const n = text.split(/\r?\n/).length;
  return text.endsWith("\n") ? n - 1 : n;
}

interface Citation {
  raw: string;            // the matched substring, for error messages
  pathOrBase: string;     // either a relative path or a bare basename
  startLine: number;
  endLine: number;        // === startLine for single-line citations
}

/**
 * Permissive regex: matches forms like
 *   file.ts:42
 *   file.ts:42-99
 *   path/to/file.rs:10
 *   src-tauri/src/lib.rs:222-251
 *   App.tsx:54,62      (we capture only the first number; second is treated as a separate citation)
 *
 * Restricted to .ts/.tsx/.rs/.js/.jsx so we don't catch arbitrary "name:42" prose.
 */
const CITATION_RE = /([A-Za-z0-9_./-]+\.(?:tsx?|rs|jsx?)):(\d+)(?:-(\d+))?/g;

function extractCitations(doc: string): Citation[] {
  const found: Citation[] = [];
  for (const m of doc.matchAll(CITATION_RE)) {
    const [raw, pathOrBase, startStr, endStr] = m;
    const startLine = Number.parseInt(startStr, 10);
    const endLine = endStr ? Number.parseInt(endStr, 10) : startLine;
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) continue;
    found.push({ raw, pathOrBase, startLine, endLine });
  }
  return found;
}

function resolveCitation(c: Citation, basenameIndex: Map<string, string[]>): string | null {
  // Path-form: contains a slash → try repo-relative first, then joined with
  // each SEARCH_ROOT (so "store/index.ts" matches "src/store/index.ts").
  if (c.pathOrBase.includes("/")) {
    const direct = join(REPO_ROOT, c.pathOrBase);
    if (existsSync(direct)) return direct;
    for (const root of SEARCH_ROOTS) {
      const candidate = join(REPO_ROOT, root, c.pathOrBase);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
  // Bare basename: look up in the index.
  const matches = basenameIndex.get(c.pathOrBase);
  if (!matches || matches.length === 0) return null;
  // If ambiguous, skip resolution (return null and let the test treat it
  // as unresolvable). In practice all current bare citations are unique.
  if (matches.length > 1) return null;
  return matches[0];
}

describe("docs/architecture.md citations", () => {
  const doc = readFileSync(ARCHITECTURE_DOC, "utf8");
  const basenameIndex = buildBasenameIndex();
  const citations = extractCitations(doc);

  it("extracts a non-trivial number of citations", () => {
    // Sanity: if this drops to zero, the regex broke.
    expect(citations.length).toBeGreaterThan(10);
  });

  it("every cited file exists (path or unique basename)", () => {
    const broken: string[] = [];
    for (const c of citations) {
      if (ALLOWED_MISSING.has(c.pathOrBase)) continue;
      const resolved = resolveCitation(c, basenameIndex);
      if (!resolved) broken.push(c.raw);
    }
    expect(broken, `Citations refer to missing files:\n  ${broken.join("\n  ")}`).toEqual([]);
  });

  it("every range citation points inside the file's actual line count", () => {
    const drift: string[] = [];
    for (const c of citations) {
      if (ALLOWED_MISSING.has(c.pathOrBase)) continue;
      const resolved = resolveCitation(c, basenameIndex);
      if (!resolved) continue; // covered by the previous test
      const total = lineCount(resolved);
      if (c.endLine > total) {
        drift.push(`${c.raw} → file has ${total} lines`);
      }
    }
    expect(drift, `Citations point past EOF:\n  ${drift.join("\n  ")}`).toEqual([]);
  });
});
