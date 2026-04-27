#!/usr/bin/env node
// Audit zoom-aware viewer CSS files for absolute font-size declarations that
// would break CSS-variable-driven zoom scaling.  A declaration is a violation
// when it (a) lives in a scanned viewer CSS file, (b) uses absolute units
// (px / pt), (c) does NOT target the zoom root element itself, and (d) is not
// annotated with `/* zoom-cascade: chrome */`.
//
// Exit codes:
//   0 — no violations
//   1 — violations found (printed with file:line)
//   2 — usage / IO error

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Configuration ─────────────────────────────────────────────────────

/** CSS files to scan, keyed by basename → zoom-root selectors. */
const ZOOM_ROOTS = {
  "source-viewer.css": [".source-view"],
  "markdown.css": [".markdown-viewer", ".markdown-body"],
  "json-tree.css": [".json-tree"],
  "csv-table.css": [".csv-table-container", ".csv-table"],
  "html-preview.css": [".html-preview"],
  "kql-plan.css": [".kql-plan-container"],
  "mermaid-view.css": [".mermaid-view"],
};

/** Max CSS files to scan — hard cap per performance.md rule 1. */
const MAX_FILES = 20;

// ── Argument parsing ──────────────────────────────────────────────────

const args = process.argv.slice(2);
let rootDir;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--root" && i + 1 < args.length) {
    rootDir = resolve(args[i + 1]);
    i++;
  }
}

if (!rootDir) {
  rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

const stylesDir = join(rootDir, "src", "styles");

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Matches `font-size:` followed by an absolute value (digits then px/pt).
 * The regex is intentionally generous — it catches `font-size: 13px`,
 * `font-size:10pt`, `font-size: 13.5px`, etc.
 */
const ABS_FONT_SIZE_RE = /font-size:\s*[\d.]+\s*(px|pt)/i;

/** Matches the `zoom-cascade: chrome` annotation comment. */
const CHROME_ANNOTATION_RE = /\/\*\s*zoom-cascade:\s*chrome\s*\*\//;

/**
 * Very lightweight selector extractor.  Walks lines backwards from
 * `lineIndex` to find the most recent non-empty, non-comment line that
 * looks like a CSS selector (ends with `{` or contains a `{`).
 *
 * Returns the raw selector string (everything before `{`), or null.
 */
function extractSelector(lines, lineIndex) {
  // If the font-size line itself contains a `{`, the rule is single-line.
  const cur = lines[lineIndex];
  const braceIdx = cur.indexOf("{");
  if (braceIdx !== -1) {
    return cur.slice(0, braceIdx).trim();
  }

  // Walk backwards to find the opening brace.
  for (let i = lineIndex - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("/*") || line.startsWith("*")) continue;
    const bi = line.indexOf("{");
    if (bi !== -1) return line.slice(0, bi).trim();
    // If we hit a `}` we've left the rule — give up.
    if (line.includes("}")) return null;
    // Might be a multi-line selector — keep going.
  }
  return null;
}

/**
 * Returns true when `selector` names exactly one of the zoom-root
 * selectors (i.e. the declaration styles the root itself, not a
 * descendant).
 */
function isZoomRootItself(selector, roots) {
  if (!selector) return false;
  // Normalise: strip combinators and pseudo-classes/elements, then check
  // whether the selector is exactly one of the roots.  We split on commas
  // for grouped selectors — every part must be a root for the whole rule
  // to be exempt.
  const parts = selector.split(",").map((s) => s.trim());
  return parts.every((part) => {
    // The selector is a root if it IS the root class (possibly with
    // pseudo-classes/elements or attribute selectors appended, but no
    // descendant combinator).
    return roots.some((root) => {
      // Exact match.
      if (part === root) return true;
      // Root + pseudo-class/element/attribute (no space = no descendant).
      // The character after the root must NOT be a word/hyphen char,
      // otherwise `.csv-table` would falsely match `.csv-table-footer`.
      if (part.startsWith(root)) {
        const rest = part.slice(root.length);
        if (/^[a-zA-Z0-9_-]/.test(rest)) return false;
        return !rest.includes(" ");
      }
      return false;
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  let entries;
  try {
    entries = readdirSync(stylesDir);
  } catch (err) {
    process.stderr.write(
      `[audit-zoom-cascade] cannot read ${stylesDir}: ${err.message}\n`,
    );
    process.exit(2);
  }

  const filesToScan = entries
    .filter((name) => ZOOM_ROOTS[name])
    .slice(0, MAX_FILES);

  if (filesToScan.length === 0) {
    process.stderr.write(
      `[audit-zoom-cascade] no scanned CSS files found in ${relative(rootDir, stylesDir) || "."}\n`,
    );
    process.exit(2);
  }

  const violations = [];

  for (const name of filesToScan) {
    const filePath = join(stylesDir, name);
    const roots = ZOOM_ROOTS[name];
    let text;
    try {
      text = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!ABS_FONT_SIZE_RE.test(line)) continue;

      // Check annotation on same line or preceding line.
      if (CHROME_ANNOTATION_RE.test(line)) continue;
      if (i > 0 && CHROME_ANNOTATION_RE.test(lines[i - 1])) continue;

      // Check if this targets the zoom root itself.
      const selector = extractSelector(lines, i);
      if (isZoomRootItself(selector, roots)) continue;

      violations.push({
        file: relative(rootDir, filePath).replace(/\\/g, "/"),
        line: i + 1,
        selector: selector ?? "(unknown)",
        snippet: line.trim(),
      });
    }
  }

  if (violations.length === 0) {
    process.stderr.write(
      `[audit-zoom-cascade] OK: ${filesToScan.length} CSS files scanned, no violations.\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    `[audit-zoom-cascade] FAIL: ${violations.length} absolute font-size violation(s):\n`,
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.file}:${v.line}  ${v.selector}\n`);
    process.stderr.write(`    > ${v.snippet}\n`);
  }
  process.exit(1);
}

main();
