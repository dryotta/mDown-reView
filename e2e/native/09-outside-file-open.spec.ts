/**
 * Issue #359 native E2E: outside-workspace file opens.
 *
 * Why native, not browser:
 *  - Real Tauri scope plugin (asset-protocol) — the browser mock in
 *    e2e/browser/fixtures/error-tracking.ts cannot model real
 *    `Scope::allow_directory` mutation; only the real binary exercises
 *    the watcher-allowlist (`tree_watched_dirs`) split from asset-scope
 *    introduced in AC3 / Group A.
 *  - Real `read_text_file` containment guard (`commands::fs::ensure_readable`)
 *    — the browser mock returns canned content regardless of guard state,
 *    which would mask the pre-fix regression where outside-workspace reads
 *    were rejected with "path not in workspace".
 *  - Real per-window canonicalisation + Tier::System classification
 *    (`commands/window_register.rs:register_window_file`).
 *
 * Each case is an IPC-contract assertion: the renderer chokepoint
 * (`store/tabs.ts:openFile`) is exercised by unit tests in
 * `src/store/__tests__/tabs.test.ts` and
 * `src/__tests__/no-classify-and-mark-readonly.test.ts` (Group C). This
 * spec proves the same contract holds in the real Tauri runtime against
 * the real Rust commands — covering the layer that browser mocks cannot.
 *
 * Cite: docs/test-strategy.md rule 14 (native-only claim) + rule 13
 * (asset-scope live-runtime requirement).
 *
 * IPC-oracle pattern (rule from docs/test-strategy.md): `expect.poll`
 * with `timeout: 15_000, intervals: [200, 500, 1000]` to cover cold
 * Windows CI startup variance.
 */

import { test, expect, setRootViaTest } from "./fixtures";
import { nativeTempDir } from "./_helpers/native-tmp";
import * as path from "path";
import * as fs from "fs";

// Smallest valid 1×1 transparent PNG (67 bytes).
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/**
 * Drive `read_text_file` through the IPC bridge and reduce to a poll-friendly
 * sentinel string. Used as the canonical "this file is reachable through the
 * workspace guard" oracle: `"ok"` if the read succeeded, otherwise the error
 * message. Wrapping with then/catch keeps `expect.poll` happy (it requires
 * a non-throwing poller).
 */
function readTextFileSentinel(nativePage: import("@playwright/test").Page, absPath: string) {
  return nativePage.evaluate((p: string) => {
    // @ts-ignore — Tauri internals are available in the WebView
    return window.__TAURI_INTERNALS__.invoke("read_text_file", { path: p })
      .then(() => "ok")
      .catch((e: unknown) => String(e));
  }, absPath);
}

/**
 * Drive `register_window_file` and reduce to `"ok"` / error sentinel.
 * Mirrors the renderer's `await registerWindowFile(path)` chokepoint
 * exercised in `store/tabs.ts:openFile` (Group C).
 */
function registerWindowFile(nativePage: import("@playwright/test").Page, absPath: string) {
  return nativePage.evaluate((p: string) => {
    // @ts-ignore — Tauri internals
    return window.__TAURI_INTERNALS__.invoke("register_window_file", { path: p })
      .then(() => "ok")
      .catch((e: unknown) => String(e));
  }, absPath);
}

test.describe("issue #359 — outside file open", () => {
  test("repro-1 — outside file IPC chain succeeds with a folder open", async ({ nativePage }) => {
    const folderA = nativeTempDir("mdr-359-folderA");
    const folderB = nativeTempDir("mdr-359-fileB");
    const insideMd = path.join(folderA, "inside.md");
    const outsideMd = path.join(folderB, "outside.md");
    fs.writeFileSync(insideMd, "# Inside\n");
    fs.writeFileSync(outsideMd, "# Outside content sentinel\n");

    try {
      // Open folderA as the workspace.
      await setRootViaTest(nativePage, folderA);

      // Pre-fix sanity: reading the outside file BEFORE register must
      // fail — proves the regression existed and the guard is real.
      // Post-fix the renderer's `openFile` action awaits register first;
      // here we drive the same ordering manually via the IPC bridge.
      await expect
        .poll(() => readTextFileSentinel(nativePage, outsideMd), {
          timeout: 15_000,
          intervals: [200, 500, 1000],
        })
        .toContain("not in workspace");

      // Register the outside file (renderer chokepoint Group C added).
      await expect
        .poll(() => registerWindowFile(nativePage, outsideMd), {
          timeout: 15_000,
          intervals: [200, 500, 1000],
        })
        .toBe("ok");

      // Post-register: read_text_file must succeed.
      await expect
        .poll(() => readTextFileSentinel(nativePage, outsideMd), {
          timeout: 15_000,
          intervals: [200, 500, 1000],
        })
        .toBe("ok");
    } finally {
      fs.rmSync(folderA, { recursive: true, force: true });
      fs.rmSync(folderB, { recursive: true, force: true });
    }
  });

  test("repro-2 — outside file IPC chain succeeds with NO folder open", async ({ nativePage }) => {
    // No `setRootViaTest` — the window has no folder claimed. Pre-fix,
    // any attempt to read the file failed (`path not in workspace`)
    // because no `tree_watched_dirs` entry covered it.
    const folderB = nativeTempDir("mdr-359-no-folder-fileB");
    const outsideMd = path.join(folderB, "outside-no-folder.md");
    fs.writeFileSync(outsideMd, "# Outside-no-folder sentinel\n");

    try {
      await expect
        .poll(() => readTextFileSentinel(nativePage, outsideMd), {
          timeout: 15_000,
          intervals: [200, 500, 1000],
        })
        .toContain("not in workspace");

      await expect
        .poll(() => registerWindowFile(nativePage, outsideMd), {
          timeout: 15_000,
          intervals: [200, 500, 1000],
        })
        .toBe("ok");

      await expect
        .poll(() => readTextFileSentinel(nativePage, outsideMd), {
          timeout: 15_000,
          intervals: [200, 500, 1000],
        })
        .toBe("ok");
    } finally {
      fs.rmSync(folderB, { recursive: true, force: true });
    }
  });

  test("repro-3 / AC4 — banner-equivalent extend_window_scope_files unblocks relative-path image", async ({
    nativePage,
  }) => {
    // This case asserts the AC3+AC4 chain that the
    // ViewerBanner "Allow for this session" click triggers:
    //   1. `register_window_file(outsideMd)` — watcher-allowlist only,
    //      does NOT widen asset-protocol scope (per
    //      `commands/window_register.rs` doc-comment line 91-92).
    //   2. Sibling `<img>` via `convertFileSrc` MUST fail to load (asset
    //      scope not granted yet).
    //   3. `extend_window_scope_files([outsideMd])` — banner click path,
    //      grants asset-protocol scope to the file's canonical parent.
    //   4. Sibling `<img>` MUST now load (`naturalWidth > 0`).
    //
    // We drive the IPC layer directly (rather than spawning a second
    // instance for CLI/single-instance forwarding) per the implementer
    // brief: "The KEY assertion is the banner→asset-scope→image-render
    // chain; the single-instance plumbing is secondary." Single-instance
    // forwarding is covered by `multiwin-concurrent-cli-launch.spec.ts`
    // and the `parse_launch_args` unit suite.
    const folderA = nativeTempDir("mdr-359-folderA-3");
    const folderB = nativeTempDir("mdr-359-fileB-3");
    const outsideMd = path.join(folderB, "with-image.md");
    const outsidePng = path.join(folderB, "logo.png");
    fs.writeFileSync(outsideMd, "# With image\n\n![logo](./logo.png)\n");
    fs.writeFileSync(outsidePng, Buffer.from(TINY_PNG_BASE64, "base64"));

    try {
      // Open folderA as the workspace (mirrors "folder open" precondition
      // of repro-3 in the issue).
      await setRootViaTest(nativePage, folderA);

      // Step 1: register the outside file (mirrors store/tabs.ts:openFile).
      await expect
        .poll(() => registerWindowFile(nativePage, outsideMd), {
          timeout: 15_000,
          intervals: [200, 500, 1000],
        })
        .toBe("ok");

      // Step 2: sibling PNG via asset-protocol must NOT load yet.
      // Use a fresh `<img>` per attempt (cache-busting `?v=` query).
      const naturalWidthBefore = await nativePage.evaluate(
        async (pngPath: string) => {
          // @ts-ignore — Tauri internals exposes convertFileSrc on the real binary
          const assetUrl = window.__TAURI_INTERNALS__.convertFileSrc(pngPath) + "?v=before";
          return await new Promise<number>((resolveP) => {
            const img = document.createElement("img");
            img.style.position = "absolute";
            img.style.left = "-9999px";
            img.onload = () => resolveP(img.naturalWidth);
            img.onerror = () => resolveP(0);
            img.src = assetUrl;
            document.body.appendChild(img);
            // Timeout: if neither event fires within 3s, treat as blocked.
            setTimeout(() => resolveP(img.naturalWidth || 0), 3000);
          });
        },
        outsidePng,
      );
      expect(naturalWidthBefore).toBe(0);

      // Step 3: simulate the banner click via the same IPC the click handler
      // invokes (`extend_window_scope_files`).
      await expect
        .poll(
          () =>
            nativePage.evaluate((p: string) => {
              // @ts-ignore — Tauri internals
              return window.__TAURI_INTERNALS__
                .invoke("extend_window_scope_files", { paths: [p] })
                .then(() => "ok")
                .catch((e: unknown) => String(e));
            }, outsideMd),
          { timeout: 15_000, intervals: [200, 500, 1000] },
        )
        .toBe("ok");

      // Step 4: the same sibling PNG must now load — proves AC4 chain.
      // Use `expect.poll` because asset-scope mutation is not synchronously
      // visible to the WebView's network layer on Windows.
      await expect
        .poll(
          () =>
            nativePage.evaluate(async (pngPath: string) => {
              // @ts-ignore — Tauri internals
              const assetUrl =
                window.__TAURI_INTERNALS__.convertFileSrc(pngPath) +
                "?v=" +
                Math.random().toString(36).slice(2);
              return await new Promise<number>((resolveP) => {
                const img = document.createElement("img");
                img.style.position = "absolute";
                img.style.left = "-9999px";
                img.onload = () => resolveP(img.naturalWidth);
                img.onerror = () => resolveP(0);
                img.src = assetUrl;
                document.body.appendChild(img);
                setTimeout(() => resolveP(img.naturalWidth || 0), 2000);
              });
            }, outsidePng),
          { timeout: 15_000, intervals: [500, 1000, 1000] },
        )
        .toBeGreaterThan(0);
    } finally {
      fs.rmSync(folderA, { recursive: true, force: true });
      fs.rmSync(folderB, { recursive: true, force: true });
    }
  });
});
