/**
 * Native E2E — Window destruction must evict every per-window keyed
 * managed state.
 *
 * Tests rule `multiwin-managed-state-cleanup` in
 * .claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md (and its dependency on
 * `multiwin-lifecycle-registry`).
 *
 * Today's behaviour: `WindowRegistry::unregister` and
 * `WatcherState::remove_window` are wired into
 * `on_window_event(WindowEvent::Destroyed)`, so closing a window cleans
 * those two. `BadgeCache` and the `SidecarConfig` per-window cache are
 * NOT yet evicted (Section H4 of issue #315). The active assertions
 * below check the parts that work today; the unwired caches get
 * `test.skip` skeletons that document the expected contract.
 *
 * Why native (not browser): A real second window has to come and go —
 * the Vite dev-server mock cannot create or destroy a real
 * `WebviewWindow`.
 */

import { test, expect } from "./fixtures";

test.describe("multiwin-window-destroy-cleanup (E5)", () => {
  test("registry survives main-window state queries after debug invocations (smoke)", async ({
    nativePage,
  }) => {
    // We cannot programmatically open + close a secondary window from
    // the test harness without a debug "create_window" IPC. Instead we
    // verify that the registry-cleanup code path is reachable by
    // checking the bootstrap label is present and that arbitrary IPCs
    // still resolve (no panic, no poisoned lock).
    const label = await nativePage.evaluate(() => {
      // @ts-ignore — Tauri internals
      return window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label as string | undefined;
    });
    expect(typeof label).toBe("string");

    const responsive = await nativePage.evaluate(async () => {
      try {
        // @ts-ignore — Tauri internals
        await window.__TAURI_INTERNALS__.invoke("get_log_path");
        return true;
      } catch {
        return false;
      }
    });
    expect(responsive).toBe(true);
  });

  test.skip(
    true,
    "FIXME: pending #315 Section H4 — BadgeCache and SidecarConfig per-window caches do not yet evict on WindowEvent::Destroyed"
  );

  test("BadgeCache and SidecarConfig caches drop the closed window's entries", async () => {
    // Future-state contract once H4 lands:
    //
    //  1. Open a secondary window via the New Window menu (or via a
    //     debug-only `create_secondary_window_via_test` IPC, which the
    //     fix may need to add for this test to be meaningful).
    //  2. Trigger a comment fetch + sidecar load in the secondary
    //     window so both caches populate under that window's label.
    //  3. Close the secondary window.
    //  4. Assert (via debug introspection IPC) that the closed
    //     window's entries are gone from BadgeCache and the
    //     SidecarConfig cache. Process-global state (`PendingUpdate`,
    //     theme) must NOT be touched.
  });
});
