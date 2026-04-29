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
  it("exits 0 when total gzipped JS is under the 2 MB limit", () => {
    const root = makeTempRoot({
      "index.js": "export const a = 1;\n".repeat(100),
      "vendor.js": "export const b = 2;\n".repeat(100),
    });
    try {
      const { status, stderr } = run(root);
      expect(status).toBe(0);
      expect(stderr).toContain("OK");
      expect(stderr).toContain("2 JS chunks");
      expect(stderr).toContain("limit 2048KB");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 1 when total gzipped JS exceeds the 2 MB limit", () => {
    // Random binary bytes are incompressible — gzip output ≈ input size.
    // 5 MB of random content gzips to ~5 MB, well over the 2 MB ceiling.
    const incompressible = randomBytes(5_000_000);
    const root = makeTempRoot({
      "huge.js": incompressible,
    });
    try {
      const { status, stderr } = run(root);
      expect(status).toBe(1);
      expect(stderr).toContain("FAIL");
      expect(stderr).toContain("exceeds 2048KB limit");
      expect(stderr).toContain("huge.js");
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
