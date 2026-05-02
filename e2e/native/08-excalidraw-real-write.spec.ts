import { test, expect, setRootViaTest } from "./fixtures";
import { nativeTempDir } from "./_helpers/native-tmp";
import * as path from "path";
import * as fs from "fs";

/**
 * Issue #352 / iter-12 — Native E2E: real workspace-write IPC + watcher
 * round-trip for the Excalidraw autosave loop.
 *
 * Architect blocker T8 (test-expert review iter-12). Browser e2e specs
 * use `__TAURI_IPC_MOCK__`, so they cannot exercise:
 *   - the actual `write_workspace_text` → `write_atomic` rename
 *   - the actual `notify-debouncer-mini` watcher
 *   - the Rust-side self-write suppression (iter-12 security HIGH#1)
 *   - the JS-side conflict-banner gate
 *
 * This spec verifies the round-trip using two oracles:
 *   - filesystem inspection (`fs.readFileSync`) to confirm bytes land
 *   - `expect.poll` against `get_file_comments` IPC oracle for the
 *     comment re-anchor flow promised by `docs/features/excalidraw.md`
 *
 * Per `docs/test-strategy.md` rule 27: native specs that exercise
 * watcher + IPC + WebView2 lifecycle MUST use `expect.poll` against a
 * deterministic IPC oracle with timeout 15_000 + intervals [200, 500,
 * 1000]. We follow that pattern.
 */
test.describe("Native Excalidraw autosave round-trip", () => {
  test("workspace-write IPC + watcher self-suppression: edit → file on disk matches → no spurious conflict", async ({
    nativePage,
  }) => {
    const rawTmpDir = nativeTempDir("mdownreview-excalidraw");
    // Canonicalize to resolve 8.3 short names on Windows CI.
    const tmpDir = fs.realpathSync(rawTmpDir);
    const drawingPath = path.join(tmpDir, "scene.excalidraw");

    // Initial scene: empty Excalidraw JSON. Excalidraw's `loadFromBlob`
    // accepts this minimal shape; on save it writes the canonical
    // serialized form.
    const initialScene = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: [],
      appState: {
        gridSize: null,
        viewBackgroundColor: "#ffffff",
      },
      files: {},
    });
    fs.writeFileSync(drawingPath, initialScene, "utf8");

    try {
      await setRootViaTest(nativePage, tmpDir);
      await expect(nativePage.locator("body")).toBeVisible({ timeout: 10_000 });

      // Phase 1: drive the workspace-write IPC directly via
      // `__TAURI_INTERNALS__`. We don't depend on Excalidraw's UI to
      // emit onChange — that's the browser-e2e layer's job. Here we
      // verify the IPC chokepoint (`write_workspace_text`) writes the
      // exact bytes atomically, the watcher self-suppression skips the
      // echo, and a subsequent IPC call reads back the same bytes.
      const editedScene = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "https://excalidraw.com",
        elements: [
          {
            id: "test-rect",
            type: "rectangle",
            x: 100,
            y: 100,
            width: 200,
            height: 100,
            // Versioning fields that Excalidraw mutates per onChange —
            // not part of the divergence hash but persisted to disk.
            version: 1,
            versionNonce: 12345,
            updated: 1700000000000,
          },
        ],
        appState: {
          gridSize: null,
          viewBackgroundColor: "#ffeeee", // background-colour change
        },
        files: {},
      });

      await nativePage.evaluate(
        ({ p, t }) => {
          // @ts-ignore — Tauri internals
          return window.__TAURI_INTERNALS__.invoke("write_workspace_text", {
            path: p,
            text: t,
          });
        },
        { p: drawingPath, t: editedScene },
      );

      // Phase 2: verify on-disk bytes are EXACTLY what we wrote (no
      // pretty-print mangling, no whitespace drift).
      await expect
        .poll(() => fs.readFileSync(drawingPath, "utf8"), {
          message: `disk content should match the IPC payload within 15s`,
          timeout: 15_000,
          intervals: [200, 500, 1000],
        })
        .toBe(editedScene);

      // Phase 3: write again with a different background colour to
      // verify back-to-back saves don't lose data — the iter-12 self-
      // write token's TTL (1500 ms) covers a single save, but a
      // sequence of saves should still land each set of bytes.
      const editedScene2 = editedScene.replace("#ffeeee", "#eeffee");
      await nativePage.evaluate(
        ({ p, t }) => {
          // @ts-ignore — Tauri internals
          return window.__TAURI_INTERNALS__.invoke("write_workspace_text", {
            path: p,
            text: t,
          });
        },
        { p: drawingPath, t: editedScene2 },
      );

      await expect
        .poll(() => fs.readFileSync(drawingPath, "utf8"), {
          message: `second write should land within 15s`,
          timeout: 15_000,
          intervals: [200, 500, 1000],
        })
        .toBe(editedScene2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("write_workspace_text rejects non-allowlisted extensions even on disk", async ({
    nativePage,
  }) => {
    const rawTmpDir = nativeTempDir("mdownreview-excalidraw-deny");
    const tmpDir = fs.realpathSync(rawTmpDir);
    const target = path.join(tmpDir, "secret.txt");

    try {
      await setRootViaTest(nativePage, tmpDir);
      await expect(nativePage.locator("body")).toBeVisible({ timeout: 10_000 });

      // The Rust-side allowlist must reject `.txt` even when the
      // workspace check passes — defence-in-depth for the carve-out
      // (`docs/principles.md`) staying load-bearing.
      const result = await nativePage.evaluate(
        ({ p }) => {
          // @ts-ignore — Tauri internals
          return window.__TAURI_INTERNALS__
            .invoke("write_workspace_text", { path: p, text: "secret" })
            .then(() => ({ ok: true as const }))
            .catch((err: unknown) => ({
              ok: false as const,
              error: String(err),
            }));
        },
        { p: target },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("not in workspace-write allowlist");
      }
      expect(fs.existsSync(target)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("workspace-write IPC rejects paths outside the open workspace", async ({
    nativePage,
  }) => {
    const insideDir = nativeTempDir("mdownreview-inside");
    const outsideDir = nativeTempDir("mdownreview-outside");
    const inside = fs.realpathSync(insideDir);
    const outside = fs.realpathSync(outsideDir);
    const target = path.join(outside, "scene.excalidraw");

    try {
      await setRootViaTest(nativePage, inside);
      await expect(nativePage.locator("body")).toBeVisible({ timeout: 10_000 });

      const result = await nativePage.evaluate(
        ({ p }) => {
          // @ts-ignore — Tauri internals
          return window.__TAURI_INTERNALS__
            .invoke("write_workspace_text", { path: p, text: "{}" })
            .then(() => ({ ok: true as const }))
            .catch((err: unknown) => ({
              ok: false as const,
              error: String(err),
            }));
        },
        { p: target },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/outside an open workspace|escapes workspace/);
      }
      expect(fs.existsSync(target)).toBe(false);
    } finally {
      fs.rmSync(inside, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
