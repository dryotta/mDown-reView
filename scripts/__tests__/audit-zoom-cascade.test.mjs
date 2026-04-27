import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = join(import.meta.dirname, "..", "audit-zoom-cascade.mjs");

/**
 * Helper: run the audit script against a temp --root directory.
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
 * Create a minimal temp root with src/styles/ containing the given files.
 * Returns the root path.  Caller must clean up.
 */
function makeTempRoot(files) {
  const root = mkdtempSync(join(tmpdir(), "zoom-audit-"));
  const stylesDir = join(root, "src", "styles");
  mkdirSync(stylesDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(stylesDir, name), content, "utf8");
  }
  return root;
}

describe("audit-zoom-cascade", () => {
  it("exits 0 when no absolute font-size violations exist", () => {
    const root = makeTempRoot({
      "csv-table.css": `.csv-table-container { height: 100%; }
.csv-table { font-size: 0.8125em; }
`,
      "markdown.css": `.markdown-viewer { padding: 20px; }
.markdown-body p { line-height: 1.6; }
`,
    });
    try {
      const { status, stderr } = run(root);
      expect(status).toBe(0);
      expect(stderr).toContain("OK");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 1 when an absolute font-size violation is found", () => {
    const root = makeTempRoot({
      "csv-table.css": `.csv-table-container { height: 100%; }
.csv-table { font-size: 0.8125em; }
.csv-table-footer {
  font-size: 14px;
}
`,
    });
    try {
      const { status, stderr } = run(root);
      expect(status).toBe(1);
      expect(stderr).toContain("FAIL");
      expect(stderr).toContain("csv-table-footer");
      expect(stderr).toContain("font-size: 14px");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows zoom-cascade: chrome annotation on same line", () => {
    const root = makeTempRoot({
      "csv-table.css": `.csv-table-container { height: 100%; }
.csv-sort-indicator {
  font-size: 10px; /* zoom-cascade: chrome */
}
`,
    });
    try {
      const { status } = run(root);
      expect(status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows zoom-cascade: chrome annotation on preceding line", () => {
    const root = makeTempRoot({
      "json-tree.css": `.json-tree { font-size: 13px; }
.json-toggle {
  /* zoom-cascade: chrome */
  font-size: 10px;
}
`,
    });
    try {
      const { status } = run(root);
      expect(status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows absolute font-size on the zoom root itself", () => {
    const root = makeTempRoot({
      "json-tree.css": `.json-tree {
  font-size: 13px;
}
`,
    });
    try {
      const { status } = run(root);
      expect(status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows relative units (em, rem, %)", () => {
    const root = makeTempRoot({
      "markdown.css": `.markdown-viewer { padding: 20px; }
.markdown-body code {
  font-size: 0.875em;
}
.markdown-body h1 { font-size: 2em; }
`,
    });
    try {
      const { status } = run(root);
      expect(status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not scan unrelated CSS files", () => {
    const root = makeTempRoot({
      // about-dialog.css is not in ZOOM_ROOTS — must be ignored.
      "about-dialog.css": `.about-version { font-size: 14px; }`,
      // Need at least one scanned file so the script doesn't exit 2.
      "csv-table.css": `.csv-table-container { height: 100%; }`,
    });
    try {
      const { status } = run(root);
      expect(status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not false-positive on root classes with similar prefixes", () => {
    // .csv-table-footer starts with .csv-table but is NOT the root.
    const root = makeTempRoot({
      "csv-table.css": `.csv-table-container { height: 100%; }
.csv-table { font-size: 0.8125em; }
.csv-table-footer {
  font-size: 12px;
}
`,
    });
    try {
      const { status, stderr } = run(root);
      expect(status).toBe(1);
      expect(stderr).toContain("csv-table-footer");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 2 when no scanned CSS files exist", () => {
    const root = makeTempRoot({
      "about-dialog.css": `.about-version { font-size: 14px; }`,
    });
    try {
      const { status, stderr } = run(root);
      expect(status).toBe(2);
      expect(stderr).toContain("no scanned CSS files");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
