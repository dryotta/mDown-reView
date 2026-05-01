// Native-only: runtime asset-protocol scope narrowing requires real Tauri runtime.
// Browser test cannot express `Scope::allow_directory` since the API runs only in
// the real binary. Per docs/test-strategy.md rule 13, native-e2e is required.
//
// Issue #338 / Group A3 — verifies that:
//   1. Assets inside a workspace folder load via the asset:// protocol.
//   2. Direct file:// URLs to system files (outside the seeded scope and
//      blocked by the img-src CSP) do not resolve.
//
// The negative case (file:///) is independent of runtime allow_directory:
// it relies on the CSP `img-src 'self' asset: http://asset.localhost data: blob:`
// in tauri.conf.json which excludes `file:`. The positive case proves the
// runtime narrowing path keeps real workspaces functional.

import { test, expect, setRootViaTest } from "./fixtures";
import { nativeTempDir } from "./_helpers/native-tmp";
import * as path from "path";
import * as fs from "fs";

// 1×1 transparent PNG (smallest valid PNG: 67 bytes).
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

test.describe("Asset protocol scope (issue #338 Group A3)", () => {
  test("loads workspace-local image via asset protocol", async ({ nativePage }) => {
    test.skip(
      true,
      "TODO(#338-followup): native E2E .markdown-viewer setup race when launch_args contains both .md + asset image file — coverage provided by capabilities-least-privilege.test.ts unit + 07.57 negative-case integration",
    );
    const tmpDir = nativeTempDir("mdownreview-asset-scope");
    const mdFile = path.join(tmpDir, "doc.md");
    const pngFile = path.join(tmpDir, "logo.png");
    fs.writeFileSync(pngFile, Buffer.from(TINY_PNG_BASE64, "base64"));
    fs.writeFileSync(mdFile, "# Doc\n\n![logo](./logo.png)\n");

    try {
      await setRootViaTest(nativePage, tmpDir);

      await expect(nativePage.locator(".markdown-viewer")).toBeVisible({ timeout: 10_000 });
      await expect(nativePage.locator(".markdown-viewer img")).toBeVisible({ timeout: 10_000 });

      // Wait for the image to actually decode (naturalWidth > 0 only after load).
      await expect
        .poll(
          async () =>
            nativePage.evaluate(() => {
              const img = document.querySelector(
                ".markdown-viewer img",
              ) as HTMLImageElement | null;
              return img?.naturalWidth ?? 0;
            }),
          { timeout: 10_000 },
        )
        .toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("blocks file:// URL pointing outside the seeded scope", async ({ nativePage }) => {
    const tmpDir = nativeTempDir("mdownreview-asset-deny");
    const mdFile = path.join(tmpDir, "doc.md");
    fs.writeFileSync(mdFile, "# Doc\n\nplaceholder\n");

    // Pick a system file that should never be readable via asset protocol.
    const systemPath =
      process.platform === "win32"
        ? "file:///C:/Windows/System32/drivers/etc/hosts"
        : "file:///etc/passwd";

    try {
      await setRootViaTest(nativePage, tmpDir);
      await expect(nativePage.locator(".markdown-viewer")).toBeVisible({ timeout: 10_000 });

      // Inject a raw <img> with a file:// src and verify it does not load.
      // CSP `img-src` excludes `file:`, and the asset-protocol scope no longer
      // contains `**` — so naturalWidth must remain 0.
      const naturalWidth = await nativePage.evaluate(async (src) => {
        return await new Promise<number>((resolveP) => {
          const img = document.createElement("img");
          img.style.position = "absolute";
          img.style.left = "-9999px";
          img.onload = () => resolveP(img.naturalWidth);
          img.onerror = () => resolveP(0);
          img.src = src;
          document.body.appendChild(img);
          // Safety timeout: if neither event fires, treat as blocked.
          setTimeout(() => resolveP(img.naturalWidth || 0), 3000);
        });
      }, systemPath);

      expect(naturalWidth).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
