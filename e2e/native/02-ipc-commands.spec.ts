import { test, expect } from "./fixtures";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

test.describe("Native IPC commands", () => {
  test("28.1 - save_review_comments writes an atomic YAML sidecar", async ({ nativePage }) => {
    const tmpDir = path.join(os.tmpdir(), `mdownreview-ipc-save-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const sourceFile = path.join(tmpDir, "doc.md");
    fs.writeFileSync(sourceFile, "# Doc");

    try {
      await nativePage.evaluate(
        ({ filePath, document }: { filePath: string; document: string }) => {
          const comments = [
            {
              id: "c1",
              author: "Tester (test)",
              timestamp: "2026-01-01T00:00:00Z",
              text: "First comment",
              resolved: false,
              line: 1,
            },
          ];
          // @ts-ignore
          return window.__TAURI_INTERNALS__.invoke("save_review_comments", {
            filePath,
            document,
            comments,
          });
        },
        { filePath: sourceFile, document: "doc.md" }
      );

      const sidecarPath = sourceFile + ".review.yaml";
      expect(fs.existsSync(sidecarPath)).toBe(true);
      const content = fs.readFileSync(sidecarPath, "utf8");
      expect(content).toContain("First comment");
      expect(content).toContain("mrsf_version");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("28.2 - scan_review_files finds sidecars in a directory tree", async ({ nativePage }) => {
    const tmpDir = path.join(os.tmpdir(), `mdownreview-ipc-scan-${Date.now()}`);
    const subDir = path.join(tmpDir, "sub");
    fs.mkdirSync(subDir, { recursive: true });

    const file1 = path.join(tmpDir, "a.md");
    const file2 = path.join(subDir, "b.md");
    fs.writeFileSync(file1, "# A");
    fs.writeFileSync(file2, "# B");
    fs.writeFileSync(file1 + ".review.yaml", `mrsf_version: "1.0"\ndocument: a.md\ncomments: []\n`);
    fs.writeFileSync(file2 + ".review.json", `{"mrsf_version":"1.0","document":"b.md","comments":[]}`);

    try {
      const pairs = await nativePage.evaluate((root: string) => {
        // @ts-ignore
        return window.__TAURI_INTERNALS__.invoke("scan_review_files", { root });
      }, tmpDir);

      expect((pairs as string[][]).length).toBe(2);
      const sidecarNames = (pairs as string[][]).map(([s]) => path.basename(s));
      expect(sidecarNames).toContain("a.md.review.yaml");
      expect(sidecarNames).toContain("b.md.review.json");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("28.3 - read_dir hides .review.yaml and .review.json sidecars", async ({ nativePage }) => {
    const tmpDir = path.join(os.tmpdir(), `mdownreview-ipc-readdir-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    fs.writeFileSync(path.join(tmpDir, "visible.md"), "# Visible");
    fs.writeFileSync(path.join(tmpDir, "visible.md.review.yaml"), `mrsf_version: "1.0"\ndocument: visible.md\ncomments: []\n`);
    fs.writeFileSync(path.join(tmpDir, "other.md.review.json"), `{"mrsf_version":"1.0","document":"other.md","comments":[]}`);

    try {
      const entries = await nativePage.evaluate((dirPath: string) => {
        // @ts-ignore
        return window.__TAURI_INTERNALS__.invoke("read_dir", { path: dirPath });
      }, tmpDir);

      const names = (entries as Array<{ name: string }>).map((e) => e.name);
      expect(names).toContain("visible.md");
      expect(names).not.toContain("visible.md.review.yaml");
      expect(names).not.toContain("other.md.review.json");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("28.4 - read_text_file rejects files larger than 10 MB", async ({ nativePage }) => {
    const tmpDir = path.join(os.tmpdir(), `mdownreview-ipc-large-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const bigFile = path.join(tmpDir, "big.txt");
    // Write 11 MB of data
    const chunk = Buffer.alloc(1024 * 1024, "x");
    const fd = fs.openSync(bigFile, "w");
    for (let i = 0; i < 11; i++) {
      fs.writeSync(fd, chunk);
    }
    fs.closeSync(fd);

    try {
      const result = await nativePage.evaluate((filePath: string) => {
        // @ts-ignore
        return window.__TAURI_INTERNALS__.invoke("read_text_file", { path: filePath })
          .then(() => "ok")
          .catch((e: unknown) => String(e));
      }, bigFile);

      expect(result).toContain("file_too_large");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
