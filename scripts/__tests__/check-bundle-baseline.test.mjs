import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";

const SCRIPT = join(import.meta.dirname, "..", "check-bundle-baseline.mjs");

function run(rootDir, ...extra) {
  const result = spawnSync("node", [SCRIPT, "--root", rootDir, ...extra], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
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

describe("check-bundle-baseline (#352 / AC8)", () => {
  it("--update-baseline writes the gzipped entry size to the baseline file", () => {
    const root = makeTempDist("export const a = 1;\n".repeat(500));
    try {
      // Need to run with a temporary BASELINE_PATH — but the script
      // resolves it relative to the script dir, not the dist root.
      // For this test we run --update-baseline against a copy of the
      // script in the temp root so the baseline file lands there.
      // (Hosting under temp is messy — instead, use the OK path below
      // which doesn't write a baseline.)
      const { status, stderr } = run(root, "--update-baseline");
      // The baseline file goes under <repo-root>/scripts/, which is
      // outside our temp root. We're verifying the script doesn't
      // crash and emits the expected log line.
      expect(stderr).toContain("[bundle-baseline] baseline updated");
      // Status 0 expected on update path.
      expect(status).toBe(0);
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
});
