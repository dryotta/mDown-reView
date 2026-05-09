/**
 * Browser regression-seal for issue #359.
 *
 * Asserts: when the renderer opens a tab, `register_window_file` is invoked
 * AND its promise resolves BEFORE `read_text_file` is dispatched. Pre-fix,
 * `read_text_file` fired first (driven by the viewer's `useFileContent`
 * effect once the tab landed in the store synchronously) and Rust rejected
 * with "path not in workspace".
 *
 * Why this lives at the browser tier (not Vitest):
 *  - The bug spans `store/tabs.ts:openFile` → `tabsHelpers.claimOrRevert`
 *    → React effect-tree scheduling → `useFileContent` IPC dispatch. Vitest
 *    can mock individual seams but cannot reproduce the real
 *    React-effect-flush timing under jsdom.
 *  - It is NOT native-only because the assertion is purely about call
 *    ordering on the IPC bridge, which Playwright's wrapped invoke can
 *    observe deterministically.
 *
 * Cite: docs/test-strategy.md rule 3 (negative seal at the right tier) +
 * AC8 of issue #359 (browser regression-seal requirement).
 */

import { test, expect } from "./fixtures";

test("register_window_file resolves BEFORE read_text_file when opening a file (#359)", async ({
  page,
}) => {
  // ── Step 1. Wrap `__TAURI_INTERNALS__.invoke` to record call order. ───
  //
  // The fixture installs `__TAURI_INTERNALS__` synchronously in its own
  // addInitScript (registered first). Playwright runs init scripts in
  // registration order, so by the time this script executes the internals
  // object already exists. Wrapping records both `start` (dispatch) and
  // `end` (resolve) phases — the negative seal asserts
  // `register_window_file:end` precedes `read_text_file:start`.
  await page.addInitScript(() => {
    (window as unknown as { __MDR_IPC_LOG__: { cmd: string; phase: string }[] }).__MDR_IPC_LOG__ =
      [];
    const internals = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== "function") return;
    const original = internals.invoke.bind(internals);
    internals.invoke = async (cmd: string, args?: unknown) => {
      (
        window as unknown as { __MDR_IPC_LOG__: { cmd: string; phase: string }[] }
      ).__MDR_IPC_LOG__.push({ cmd, phase: "start" });
      try {
        const result = await original(cmd, args);
        (
          window as unknown as { __MDR_IPC_LOG__: { cmd: string; phase: string }[] }
        ).__MDR_IPC_LOG__.push({ cmd, phase: "end" });
        return result;
      } catch (err) {
        (
          window as unknown as { __MDR_IPC_LOG__: { cmd: string; phase: string }[] }
        ).__MDR_IPC_LOG__.push({ cmd, phase: "end" });
        throw err;
      }
    };
  });

  // ── Step 2. Custom mock returning content for `read_text_file`. ───
  //
  // The fixture's default mock for `register_window_file` returns
  // `{canonical, classification:{tier:"inside"}}` synchronously (line 168
  // of e2e/browser/fixtures/error-tracking.ts). We don't need to override
  // that — call ordering is sufficient to seal the regression.
  await page.addInitScript(() => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
      if (cmd === "read_text_file") return "# Launched\n\nbody";
      if (cmd === "read_dir") return [];
      if (cmd === "load_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
      return null;
    };
  });

  // ── Step 3. Drive a tab open via the launch-args queue. ───
  // Pre-seed the in-page queue via addInitScript (must run BEFORE the
  // page mounts so the bootstrap effect picks it up on first drain —
  // mirrors cli-open.spec.ts:8). `queueLaunchArgs` uses `page.evaluate`
  // which would fail with "fixture init script missing" pre-navigation.
  await page.addInitScript((vals: { files: string[]; folders: string[] }[]) => {
    const fn = (
      window as unknown as {
        __TAURI_QUEUE_LAUNCH_ARGS__?: (v: { files: string[]; folders: string[] }[]) => void;
      }
    ).__TAURI_QUEUE_LAUNCH_ARGS__;
    if (typeof fn === "function") fn(vals);
  }, [{ files: ["/test/regression-seal.md"], folders: [] }]);

  await page.goto("/");
  await expect(page.locator(".app-layout")).toBeVisible();
  await expect(page.locator(".tab-bar").getByText("regression-seal.md")).toBeVisible();

  // ── Step 4. Read back the IPC log and assert ordering. ───
  const log: { cmd: string; phase: string }[] = await page.evaluate(
    () =>
      (window as unknown as { __MDR_IPC_LOG__: { cmd: string; phase: string }[] }).__MDR_IPC_LOG__,
  );

  // Find the FIRST register_window_file resolution and the FIRST
  // read_text_file dispatch (subsequent calls don't matter — we're
  // asserting the ordering on the cold-open path).
  const regEnd = log.findIndex((e) => e.cmd === "register_window_file" && e.phase === "end");
  const readStart = log.findIndex((e) => e.cmd === "read_text_file" && e.phase === "start");

  expect(regEnd, "register_window_file must complete on cold open").toBeGreaterThanOrEqual(0);
  expect(readStart, "read_text_file must be dispatched on cold open").toBeGreaterThanOrEqual(0);
  expect(
    readStart,
    "read_text_file must dispatch AFTER register_window_file resolves (issue #359 ordering bug)",
  ).toBeGreaterThan(regEnd);
});
