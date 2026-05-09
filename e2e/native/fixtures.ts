import { test as base, chromium, type Page } from "@playwright/test";

const CDP_PORT = 9222;

const test = base.extend<{ nativePage: Page }>({
  nativePage: async ({}, use) => {
    if (process.platform !== "win32") {
      test.skip(true, "Native UI tests require Windows (WebView2 + CDP)");
      await use(null as unknown as Page);
      return;
    }
    const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);

    // On CI the WebView may not have a browsing context immediately after CDP
    // connects.  Retry until at least one context with a page appears.
    let page: Page | undefined;
    for (let i = 0; i < 30; i++) {
      const contexts = browser.contexts();
      if (contexts.length > 0) {
        const pages = contexts[0].pages();
        if (pages.length > 0) {
          page = pages[0];
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!page) throw new Error("No page found via CDP after 15 s");

    // Wait for Tauri JS bridge to be injected (may lag behind page load on CI)
    await page.waitForFunction(() => !!(window as any).__TAURI_INTERNALS__, null, {
      timeout: 15_000,
    });

    // Issue #366: clear per-window watcher state (tree_watched_dirs +
    // watched_paths for this window's label) so each spec starts from
    // an empty precondition. Fixture-level reset (not module-scope
    // `test.beforeEach`) keeps "every spec using nativePage is reset"
    // as a static invariant — see iter-1 architect-expert review.
    // Single-attempt invoke; the IPC is debug-only and synchronous;
    // `__TAURI_INTERNALS__` is guaranteed live by the preceding
    // waitForFunction. See docs/test-strategy.md rule 29 and
    // docs/security.md rule 17.
    await page.evaluate(() => {
      // @ts-ignore — Tauri internals are available in the WebView
      return window.__TAURI_INTERNALS__.invoke("reset_window_scope_for_test");
    });

    await use(page);
    // close() on a CDP-connected browser disconnects without killing the process
    await browser.close();
  },
});

/** Invoke the debug-only set_root_via_test command, opening a folder and its files. */
export async function setRootViaTest(nativePage: Page, folder: string): Promise<void> {
  await nativePage.evaluate((path: string) => {
    // @ts-ignore — Tauri internals are available in the WebView
    return window.__TAURI_INTERNALS__.invoke("set_root_via_test", { path });
  }, folder);
}

/**
 * Invoke the debug-only `open_file_via_test` command, forwarding an
 * outside-file open through the `args-received` chokepoint. Mirrors the
 * CLI / OS file-open path (`route_args_through_registry` AddToWindow arm
 * for FilesParents) — used by native E2E because Playwright cannot spawn
 * a second binary instance to drive single-instance forwarding directly.
 *
 * The renderer's `useLaunchArgsBootstrap` drains the queue, dispatches
 * `store.openFile(path)` (which atomically `register_window_file`s and
 * appends to `tabs[]`), and `useFileWatcher` then commits
 * `update_watched_files` with the resulting tab paths. Issue #369.
 */
export async function openFileViaTest(nativePage: Page, file: string): Promise<void> {
  await nativePage.evaluate((p: string) => {
    // @ts-ignore — Tauri internals are available in the WebView
    return window.__TAURI_INTERNALS__.invoke("open_file_via_test", { path: p });
  }, file);
}

export { test };
export { expect } from "@playwright/test";
