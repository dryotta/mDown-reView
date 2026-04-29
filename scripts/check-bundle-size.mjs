#!/usr/bin/env node
// Check the gzipped size of the Vite build output (`dist/assets/*.js`) against
// a hard ceiling.  Static-prevention guard for the Lean pillar: keeps shipped
// JS payload bounded so renderer startup stays fast and the desktop bundle
// doesn't bloat over time.
//
// Behaviour:
//   • Reads every `*.js` under `dist/assets/` (relative to --root, default
//     parent of this script's directory).
//   • Gzips each file's bytes in-memory with `gzipSync` (default level).
//   • Sums the gzipped sizes and compares against MAX_GZIPPED_BYTES (2 MB).
//
// Exit codes:
//   0 — total ≤ threshold (prints OK summary to stderr)
//   1 — total > threshold (prints per-chunk breakdown sorted desc + delta)
//   2 — usage / IO error (no dist/assets/ or no .js files)

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// ── Configuration ─────────────────────────────────────────────────────

/** Hard ceiling for total gzipped JS size (bytes). */
const MAX_GZIPPED_BYTES = 2 * 1024 * 1024;

/** Max JS files to scan — hard cap per performance.md rule 1. */
const MAX_FILES = 200;

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

const assetsDir = join(rootDir, "dist", "assets");

// ── Helpers ───────────────────────────────────────────────────────────

/** Format bytes as a whole-number kilobyte string (e.g. `1234KB`). */
function kb(bytes) {
  return `${Math.round(bytes / 1024)}KB`;
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  let entries;
  try {
    entries = readdirSync(assetsDir);
  } catch {
    process.stderr.write(
      "[check-bundle-size] cannot find dist/assets/*.js — run `npm run build` first\n",
    );
    process.exit(2);
  }

  const jsFiles = entries
    .filter((name) => name.endsWith(".js"))
    .slice(0, MAX_FILES);

  if (jsFiles.length === 0) {
    process.stderr.write(
      "[check-bundle-size] cannot find dist/assets/*.js — run `npm run build` first\n",
    );
    process.exit(2);
  }

  const chunks = [];
  let total = 0;

  for (const name of jsFiles) {
    const filePath = join(assetsDir, name);
    let bytes;
    try {
      bytes = readFileSync(filePath);
    } catch (err) {
      process.stderr.write(
        `[check-bundle-size] cannot read ${relative(rootDir, filePath)}: ${err.message}\n`,
      );
      process.exit(2);
    }
    const gzipped = gzipSync(bytes).length;
    chunks.push({ name, gzipped });
    total += gzipped;
  }

  const limitKb = Math.round(MAX_GZIPPED_BYTES / 1024);

  if (total <= MAX_GZIPPED_BYTES) {
    process.stderr.write(
      `[check-bundle-size] OK: ${chunks.length} JS chunks, ${kb(total)} gzipped (limit ${limitKb}KB).\n`,
    );
    process.exit(0);
  }

  const delta = total - MAX_GZIPPED_BYTES;
  process.stderr.write(
    `[check-bundle-size] FAIL: ${chunks.length} JS chunks, ${kb(total)} gzipped exceeds ${limitKb}KB limit by ${kb(delta)}.\n`,
  );
  chunks.sort((a, b) => b.gzipped - a.gzipped);
  for (const c of chunks) {
    process.stderr.write(`  ${kb(c.gzipped).padStart(8)}  ${c.name}\n`);
  }
  process.exit(1);
}

main();
