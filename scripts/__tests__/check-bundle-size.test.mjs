import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const SCRIPT = join(import.meta.dirname, "..", "check-bundle-size.mjs");

/**
 * Run the bundle-size script against a temp --root directory.
 * Returns { status, stderr }.
 */
function run(rootDir) {
  const result = spawnSync("node", [SCRIPT, "--root", rootDir], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return { status: result.status, stderr: result.stderr ?? "" };
}

/**
 * Create a temp root with `dist/assets/` containing the given files.
 * `files` maps filename → Buffer | string content.
 * Returns the root path.  Caller cleans up.
 */
function makeTempRoot(files) {
  const root = mkdtempSync(join(tmpdir(), "bundle-size-"));
  if (files) {
    const assetsDir = join(root, "dist", "assets");
    mkdirSync(assetsDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(assetsDir, name), content);
    }
  }
  return root;
}

describe("check-bundle-size", () => {
  it("exits 0 when total gzipped JS is under the 3 MB limit", () => {
    const root = makeTempRoot({
      "index.js": "export const a = 1;\n".repeat(100),
      "vendor.js": "export const b = 2;\n".repeat(100),
    });
    try {
      const { status, stderr } = run(root);
      expect(status).toBe(0);
      expect(stderr).toContain("OK");
      expect(stderr).toContain("2 JS chunks");
      expect(stderr).toContain("limit 3072KB");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 1 when total gzipped JS exceeds the 3 MB limit", () => {
    // Random binary bytes are incompressible — gzip output ≈ input size.
    // 5 MB of random content gzips to ~5 MB, well over the 3 MB ceiling.
    const incompressible = randomBytes(5_000_000);
    const root = makeTempRoot({
      "huge.js": incompressible,
    });
    try {
      const { status, stderr } = run(root);
      expect(status).toBe(1);
      expect(stderr).toContain("FAIL");
      expect(stderr).toContain("exceeds 3072KB limit");
      expect(stderr).toContain("huge.js");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scans every JS file (no silent truncation)", () => {
    // Regression test: a previous version `.slice(0, 200)`-truncated the
    // file list, hiding chunks beyond the 200th from the gzip total. Build
    // 250 small JS files plus one 4 MB incompressible random file: the
    // script must (a) report 251 chunks and (b) exit 1 because the random
    // file pushes the total over the 3 MB ceiling. Both conditions must
    // hold — a re-introduced truncation would either drop chunks from the
    // count or skip the 4 MB file (which sorts last alphabetically), both
    // of which this test catches.
    const files = {};
    // Names z000.js … z249.js sort after `huge.js`, so any positional
    // truncation that drops the tail also drops these.
    for (let i = 0; i < 250; i++) {
      files[`z${String(i).padStart(3, "0")}.js`] = "a".repeat(1000);
    }
    files["huge.js"] = randomBytes(4_000_000);
    const root = makeTempRoot(files);
    try {
      const { status, stderr } = run(root);
      expect(stderr).toContain("251 JS chunks");
      expect(status).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 2 when dist/ does not exist", () => {
    const root = makeTempRoot(null);
    try {
      const { status, stderr } = run(root);
      expect(status).toBe(2);
      expect(stderr).toContain("cannot find");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 2 when dist/assets exists but contains no .js files", () => {
    const root = mkdtempSync(join(tmpdir(), "bundle-size-"));
    const assetsDir = join(root, "dist", "assets");
    mkdirSync(assetsDir, { recursive: true });
    // Non-JS file should be ignored, leaving the chunk count at zero.
    writeFileSync(join(assetsDir, "styles.css"), ".x { color: red; }");
    try {
      const { status, stderr } = run(root);
      expect(status).toBe(2);
      expect(stderr).toContain("cannot find");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
