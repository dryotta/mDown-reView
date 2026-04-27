#!/usr/bin/env node
// Lint guard: every <ReactMarkdown> JSX site must be wrapped by an element
// whose className includes one of the allowlisted cascade classes.
// See docs/best-practices-project/markdown-surfaces.md
// Introduced by #153 to prevent the #91 → #150 recurrence pattern.

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

// Classes that carry the md-wrap-cascade overflow rules.
// To add a new ReactMarkdown surface: add its wrapper class here.
const ALLOWLIST = new Set(["markdown-body", "comment-text"]);

// Files that reference <ReactMarkdown but are not mounting surfaces
// (e.g. test fixtures, component maps that render children).
const IGNORED_FILES = new Set([
  "src/components/viewers/markdown/__tests__/MarkdownComponentsMap.test.tsx",
]);

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__mocks__") continue;
      results.push(...walk(full));
    } else if (entry.name.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

/** @param {string} filePath */
export function checkFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("<ReactMarkdown")) continue;

    // Search backwards for the nearest className on an enclosing element
    let hasAllowlisted = false;
    let hasCascade = false;
    for (let j = i; j >= Math.max(0, i - 15); j--) {
      const classMatch = lines[j].match(/className="([^"]+)"/);
      if (classMatch) {
        const classes = classMatch[1].split(/\s+/);
        hasAllowlisted = classes.some((c) => ALLOWLIST.has(c));
        hasCascade = classes.includes("md-wrap-cascade");
        break; // Found the nearest className, stop searching
      }
    }

    if (!hasAllowlisted || !hasCascade) {
      const reason = !hasAllowlisted
        ? `not wrapped by an allowlisted class (${[...ALLOWLIST].join(", ")})`
        : "missing md-wrap-cascade class on wrapper";
      errors.push({
        file: relative(".", filePath).replace(/\\/g, "/"),
        line: i + 1,
        reason,
      });
    }
  }

  return errors;
}

// --root <dir> allows tests to point at a temp tree instead of src/
const rootIdx = process.argv.indexOf("--root");
const srcDir = rootIdx !== -1 ? process.argv[rootIdx + 1] : join(".", "src");

const files = walk(srcDir);
const allErrors = [];

for (const file of files) {
  const rel = relative(".", file).replace(/\\/g, "/");
  if (IGNORED_FILES.has(rel)) continue;
  allErrors.push(...checkFile(file));
}

if (allErrors.length > 0) {
  console.error(
    "❌ ReactMarkdown surfaces missing overflow-wrap cascade class:",
  );
  for (const err of allErrors) {
    console.error(
      `  ${err.file}:${err.line} — <ReactMarkdown> ${err.reason}`,
    );
  }
  console.error(
    `\nFix: wrap <ReactMarkdown> in a <div className="<allowlisted> md-wrap-cascade"> where allowlisted is one of: ${[...ALLOWLIST].join(", ")}`,
  );
  console.error(
    "To add a new surface: add its wrapper class to ALLOWLIST in scripts/check-markdown-surfaces.mjs and apply md-wrap-cascade.",
  );
  process.exit(1);
} else {
  console.log(
    `✅ All ${files.length} .tsx files checked — ${allErrors.length} unguarded ReactMarkdown surfaces found.`,
  );
}
