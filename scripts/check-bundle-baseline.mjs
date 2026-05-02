#!/usr/bin/env node
// Issue #352 / AC8 — verify the main entry bundle hasn't bloated due to
// the Excalidraw integration. Per the AC: "main bundle size unchanged
// within ±5%; Excalidraw chunk lazy-loaded on first open".
//
// We treat `dist/assets/index-*.js` as the main entry chunk (Vite emits
// the entrypoint chunk with `index-` prefix). A baseline is pinned in
// `scripts/bundle-baseline.json`; this script reads the gzipped size of
// the entry chunk and asserts it's within ±5% of the baseline. The
// total bundle ceiling (5 MB) is enforced separately by
// `scripts/check-bundle-size.mjs`.
//
// Negative assertion — Excalidraw must NOT enter the main bundle: we
// search the entry-chunk bytes (decompressed) for the literal sentinel
// `@excalidraw/excalidraw`. A static (non-lazy) import of the package
// leaves this string in the chunk; a `lazy(() => import(...))` boundary
// puts it in a separate chunk. If the sentinel appears in the entry,
// the lazy boundary has been broken.
//
// Exit codes:
//   0 — entry within ±5% of baseline AND lazy boundary intact
//   1 — entry size out of band, or Excalidraw leaked into the entry
//   2 — usage / IO error (no dist, no baseline, etc.)

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(HERE, "bundle-baseline.json");

// ── Argument parsing ──────────────────────────────────────────────────

const args = process.argv.slice(2);
let rootDir;
let updateBaseline = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--root" && i + 1 < args.length) {
    rootDir = resolve(args[i + 1]);
    i++;
  } else if (args[i] === "--update-baseline") {
    updateBaseline = true;
  }
}
if (!rootDir) {
  rootDir = resolve(HERE, "..");
}

const assetsDir = join(rootDir, "dist", "assets");

// ── Helpers ───────────────────────────────────────────────────────────

function kb(bytes) {
  return `${Math.round(bytes / 1024)}KB`;
}

function findEntryChunk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  // Vite emits multiple `index-*.js` chunks (one per entry-point + a
  // few synthetic entries for chunked legacy modules). The MAIN entry
  // — the SPA's `index.html` script — is consistently the largest of
  // these. The lazy chunks (e.g. `ExcalidrawView-*.js`) are named
  // after the imported module, so the regex never matches them. Pick
  // the largest matching file as the heuristic for "main entry".
  const matches = entries.filter(
    (n) => /^index-[A-Za-z0-9_-]+\.js$/.test(n),
  );
  if (matches.length === 0) return null;
  let best = null;
  let bestSize = -1;
  for (const name of matches) {
    const stat = readFileSync(join(dir, name));
    if (stat.length > bestSize) {
      bestSize = stat.length;
      best = name;
    }
  }
  return best;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

function writeBaseline(obj) {
  const text = JSON.stringify(obj, null, 2) + "\n";
  writeFileSync(BASELINE_PATH, text, "utf8");
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const entryName = findEntryChunk(assetsDir);
  if (!entryName) {
    process.stderr.write(
      `[bundle-baseline] cannot find dist/assets/index-*.js — run \`npm run build\` first\n`,
    );
    process.exit(2);
  }

  const entryBytes = readFileSync(join(assetsDir, entryName));
  const gzippedBytes = gzipSync(entryBytes).length;
  const decompressed = entryBytes.toString("utf8");

  // Negative assertion: lazy boundary intact.
  const sentinel = "@excalidraw/excalidraw";
  if (decompressed.includes(sentinel)) {
    process.stderr.write(
      `[bundle-baseline] FAIL: Excalidraw sentinel "${sentinel}" found in main entry chunk ${entryName} — lazy boundary broken.\n`,
    );
    process.exit(1);
  }

  if (updateBaseline) {
    writeBaseline({
      entry_gzipped_bytes: gzippedBytes,
      entry_chunk_pattern: "index-*.js",
      tolerance_pct: 5,
      updated_at: new Date().toISOString(),
    });
    process.stderr.write(
      `[bundle-baseline] baseline updated to ${kb(gzippedBytes)} (${gzippedBytes} bytes gzipped)\n`,
    );
    process.exit(0);
  }

  const baseline = loadBaseline();
  if (!baseline) {
    process.stderr.write(
      `[bundle-baseline] no baseline file at ${BASELINE_PATH} — run with --update-baseline first\n`,
    );
    process.exit(2);
  }

  const baselineBytes = baseline.entry_gzipped_bytes;
  const tolerancePct = baseline.tolerance_pct ?? 5;
  const upper = baselineBytes * (1 + tolerancePct / 100);
  const lower = baselineBytes * (1 - tolerancePct / 100);
  const deltaPct = ((gzippedBytes - baselineBytes) / baselineBytes) * 100;

  if (gzippedBytes > upper) {
    process.stderr.write(
      `[bundle-baseline] FAIL: main entry chunk ${entryName} = ${kb(gzippedBytes)} gzipped, exceeds baseline ${kb(baselineBytes)} by ${deltaPct.toFixed(1)}% (max +${tolerancePct}%).\n`,
    );
    process.exit(1);
  }
  if (gzippedBytes < lower) {
    // Bundle SHRANK by more than the tolerance — this is suspicious
    // (lazy split worked too well? icons removed?) but not a failure.
    // Surface as a notice so a follow-up `--update-baseline` can rebase.
    process.stderr.write(
      `[bundle-baseline] WARN: main entry chunk ${entryName} = ${kb(gzippedBytes)} gzipped, BELOW baseline ${kb(baselineBytes)} by ${(-deltaPct).toFixed(1)}%. Consider \`--update-baseline\`.\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    `[bundle-baseline] OK: main entry chunk ${entryName} = ${kb(gzippedBytes)} gzipped (baseline ${kb(baselineBytes)} ±${tolerancePct}%, delta ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%). Lazy boundary intact (no Excalidraw sentinel in entry).\n`,
  );
  process.exit(0);
}

main();
