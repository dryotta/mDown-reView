import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";

const SCRIPT = join(import.meta.dirname, "..", "check-bundle-baseline.mjs");

function run(rootDir, ...extra) {
  // Each test gets a per-temp-root baseline file so the suite never
  // touches the checked-in `scripts/bundle-baseline.json`.
  const baseline = join(rootDir, "scripts", "bundle-baseline.json");
  // Ensure the parent dir exists for --update-baseline to write into.
  mkdirSync(join(rootDir, "scripts"), { recursive: true });
  const result = spawnSync(
    "node",
    [SCRIPT, "--root", rootDir, "--baseline", baseline, ...extra],
    {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  return { status: result.status, stderr: result.stderr ?? "" };
}

function makeTempDist(entryContent, otherFiles = {}) {
  const root = mkdtempSync(join(tmpdir(), "bundle-baseline-"));
  const assetsDir = join(root, "dist", "assets");
  mkdirSync(assetsDir, { recursive: true });
  // Vite-style hashed entry chunk.
  writeFileSync(join(assetsDir, "index-AAAAAAAA.js"), entryContent);
  for (const [name, content] of Object.entries(otherFiles)) {
    writeFileSync(join(assetsDir, name), content);
  }
  return root;
}

/** Pre-create a baseline file so we can test pass/fail/warn paths. */
function pinBaseline(rootDir, gzippedBytes) {
  const baselinePath = join(rootDir, "scripts", "bundle-baseline.json");
  mkdirSync(join(rootDir, "scripts"), { recursive: true });
  writeFileSync(
    baselinePath,
    JSON.stringify({
      entry_gzipped_bytes: gzippedBytes,
      entry_chunk_pattern: "index-*.js",
      tolerance_pct: 5,
      updated_at: new Date().toISOString(),
    }),
  );
}

describe("check-bundle-baseline (#352 / AC8)", () => {
  it("--update-baseline writes the gzipped entry size to the supplied baseline file", () => {
    const root = makeTempDist("export const a = 1;\n".repeat(500));
    try {
      const { status, stderr } = run(root, "--update-baseline");
      expect(status).toBe(0);
      expect(stderr).toContain("[bundle-baseline] baseline updated");
      // Baseline file lives under the temp root, not the real repo.
      const baseline = JSON.parse(
        readFileSync(join(root, "scripts", "bundle-baseline.json"), "utf8"),
      );
      expect(baseline.entry_gzipped_bytes).toBeGreaterThan(0);
      expect(baseline.tolerance_pct).toBe(5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("PASSES when the entry size is within ±5% of the baseline", () => {
    const root = makeTempDist("export const a = 1;\n".repeat(500));
    try {
      // Compute the expected gzipped size and pin it as baseline.
      const bytes = readFileSync(join(root, "dist", "assets", "index-AAAAAAAA.js"));
      const gzipped = gzipSync(bytes).length;
      pinBaseline(root, gzipped);
      const { status, stderr } = run(root);
      expect(status).toBe(0);
      expect(stderr).toContain("[bundle-baseline] OK");
      expect(stderr).toContain("Lazy boundary intact");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("FAILS exit 1 when the entry size exceeds baseline by more than +5%", () => {
    // Random bytes resist gzip — entry will be >> baseline.
    const root = makeTempDist(randomBytes(50_000));
    try {
      // Pin baseline at half the actual size so the real entry comes
      // in well over +5%.
      const bytes = readFileSync(join(root, "dist", "assets", "index-AAAAAAAA.js"));
      const realGzipped = gzipSync(bytes).length;
      pinBaseline(root, Math.floor(realGzipped / 2));
      const { status, stderr } = run(root);
      expect(status).toBe(1);
      expect(stderr).toContain("[bundle-baseline] FAIL");
      expect(stderr).toContain("exceeds baseline");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("WARNS but exits 0 when the entry shrank below baseline (suspicious but not a regression)", () => {
    const root = makeTempDist("export const a = 1;\n".repeat(50));
    try {
      // Pin a baseline 4× larger than the actual entry size.
      const bytes = readFileSync(join(root, "dist", "assets", "index-AAAAAAAA.js"));
      const realGzipped = gzipSync(bytes).length;
      pinBaseline(root, realGzipped * 4);
      const { status, stderr } = run(root);
      expect(status).toBe(0);
      expect(stderr).toContain("[bundle-baseline] WARN");
      expect(stderr).toContain("BELOW baseline");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("FAILS when the main entry chunk contains the @excalidraw/excalidraw sentinel (lazy boundary broken)", () => {
    // Smaller entry but containing the sentinel string — emulates a
    // scenario where someone added a static `import "@excalidraw/excalidraw"`
    // at the top of the entry module.
    const offendingEntry = `console.log("entry");\n// @excalidraw/excalidraw\n`.repeat(10);
    const root = makeTempDist(offendingEntry);
    try {
      const { status, stderr } = run(root);
      expect(status).toBe(1);
      expect(stderr).toContain("lazy boundary broken");
      expect(stderr).toContain("@excalidraw/excalidraw");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 2 when dist/assets is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "bundle-baseline-"));
    try {
      const { status, stderr } = run(root);
      expect(status).toBe(2);
      expect(stderr).toContain("cannot find dist/assets/index-*.js");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 2 when no baseline file is configured", () => {
    const root = makeTempDist("export const a = 1;");
    try {
      // No pinBaseline call → script can't read a baseline.
      const { status, stderr } = run(root);
      expect(status).toBe(2);
      expect(stderr).toContain("no baseline file");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
