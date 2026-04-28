import { test, expect, setRootViaTest } from "./fixtures";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

test.describe("Native .mrsf.yaml config reload (full-stack watcher)", () => {
  test("29.1 - dropping .mrsf.yaml triggers config reload and redirects sidecar writes", async ({
    nativePage,
  }) => {
    const tmpDir = path.join(os.tmpdir(), `mdownreview-mrsf-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const docFile = path.join(tmpDir, "readme.md");
    fs.writeFileSync(docFile, "# Hello\n\nTest content for MRSF config reload.");

    try {
      await setRootViaTest(nativePage, tmpDir);

      // Wait for the app to render the file
      await expect(nativePage.locator(".markdown-viewer")).toBeVisible({ timeout: 10_000 });
      await expect(nativePage.locator(".markdown-viewer")).toContainText("Hello", {
        timeout: 5_000,
      });

      // Give the watcher time to register
      await nativePage.waitForTimeout(2000);

      // Drop .mrsf.yaml — watcher should detect and reload config internally
      fs.writeFileSync(
        path.join(tmpDir, ".mrsf.yaml"),
        "sidecar_root: .reviews\n",
      );

      // Wait for watcher to pick up the .mrsf.yaml change (debounce 300ms + processing)
      await nativePage.waitForTimeout(3000);

      // Add a comment via IPC — should land in .reviews/ not co-located
      await nativePage.evaluate(() => {
        // @ts-ignore — Tauri internals
        return window.__TAURI_INTERNALS__.invoke("add_comment", {
          filePath: document.querySelector("[data-file-path]")?.getAttribute("data-file-path"),
          author: "e2e-test",
          text: "Comment under sidecar_root",
          anchor: null,
          commentType: null,
          severity: null,
          document: null,
        });
      });

      // Wait briefly for the sidecar write
      await nativePage.waitForTimeout(1000);

      // Verify: sidecar landed in .reviews/ directory
      const reviewsDir = path.join(tmpDir, ".reviews");
      expect(fs.existsSync(reviewsDir)).toBe(true);

      // Find the sidecar file under .reviews/
      const sidecarPath = path.join(reviewsDir, "readme.md.review.yaml");
      expect(fs.existsSync(sidecarPath)).toBe(true);

      // Verify co-located sidecar was NOT created
      const colocated = path.join(tmpDir, "readme.md.review.yaml");
      expect(fs.existsSync(colocated)).toBe(false);

      // Read sidecar and verify content
      const content = fs.readFileSync(sidecarPath, "utf-8");
      expect(content).toContain("Comment under sidecar_root");
      expect(content).toContain("e2e-test");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
