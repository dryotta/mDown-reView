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
 * Register a one-shot listener for a Tauri event inside the WebView and
 * return a Promise that resolves with the event payload (or rejects on
 * timeout). Mirrors the `__TAURI_INTERNALS__` invocation pattern used in
 * 05-multi-window.spec.ts.
 *
 * Registration barrier: `__TAURI_INTERNALS__.event.listen()` itself returns
 * a Promise (registration is async via IPC). This helper awaits that
 * registration internally — by the time the returned Promise has its
 * registration phase complete, the listener is live in the WebView.
 *
 * Usage (listen-then-write):
 *   const eventPromise = waitForTauriEvent<{ path: string }>(
 *     nativePage, 'sidecar-config-changed', 10_000,
 *   );
 *   fs.writeFileSync(...);  // trigger
 *   const payload = await eventPromise;
 *
 * Note: the in-page listener and `__TAURI_EVENT_*` window properties are
 * intentionally leaked — acceptable for a one-shot E2E. Do not call this
 * twice concurrently in the same WebView; the second call overwrites the
 * first call's stored Promise.
 */
export async function waitForTauriEvent<T = unknown>(
  page: Page,
  event: string,
  timeoutMs = 10_000,
): Promise<T> {
  await page.evaluate(
    ({ event, timeoutMs }) => {
      // @ts-ignore — Tauri internals are available in the WebView
      const internals = window.__TAURI_INTERNALS__;
      // @ts-ignore — leaked for cross-evaluate retrieval
      window.__TAURI_EVENT_REGISTERED__ = false;
      // @ts-ignore — leaked for cross-evaluate retrieval
      window.__TAURI_EVENT_PROMISE__ = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timeout waiting for ${event}`)),
          timeoutMs,
        );
        internals.event
          .listen(event, (e: { payload: unknown }) => {
            clearTimeout(timer);
            resolve(e.payload);
          })
          .then(() => {
            // @ts-ignore — leaked
            window.__TAURI_EVENT_REGISTERED__ = true;
          });
      });
    },
    { event, timeoutMs },
  );
  // Wait for the listen() IPC round-trip to complete before the caller can
  // race ahead and trigger the event.
  await page.waitForFunction(
    // @ts-ignore — leaked
    () => window.__TAURI_EVENT_REGISTERED__ === true,
    undefined,
    { timeout: 2_000 },
  );
  // page.evaluate awaits the returned in-page Promise, so this resolves
  // with the event payload once the event fires (or rejects on timeout).
  return page.evaluate(
    // @ts-ignore — leaked
    () => window.__TAURI_EVENT_PROMISE__ as Promise<unknown>,
  ) as Promise<T>;
}

export { test };
export { expect } from "@playwright/test";
