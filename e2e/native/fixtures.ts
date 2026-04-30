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
 * Register a Tauri event listener inside the WebView, run the trigger
 * callback after registration completes, then resolve with the event payload.
 *
 * The callback-trigger shape eliminates the registration-vs-trigger race
 * (caller cannot accidentally fire the trigger before the listener is live).
 *
 * Implementation uses an in-page state-polling pattern (no cross-context
 * Promise transfer) to avoid Playwright SharedWorker target-attach races on
 * Windows WebView2 — Tauri's IPC backend may spawn a SharedWorker on
 * `listen()` registration that Playwright tries to attach to and races with
 * a `page.evaluate(() => __TAURI_EVENT_PROMISE__)` round-trip.
 *
 * Usage:
 *   const payload = await waitForTauriEvent<{ path: string }>(
 *     nativePage,
 *     'sidecar-config-changed',
 *     async () => { fs.writeFileSync(...); },
 *     10_000,
 *   );
 *
 * Note: window-leaked properties (`__TAURI_EVENT_RESULT__` etc.) are
 * intentional — acceptable for a one-shot E2E. Do not call this twice
 * concurrently in the same WebView; the second call overwrites the first.
 */
export async function waitForTauriEvent<T = unknown>(
  page: Page,
  event: string,
  trigger: () => void | Promise<void>,
  timeoutMs = 10_000,
): Promise<T> {
  // Phase 1: register listener inside the page using state-polling pattern.
  // Capture either the event payload or a registration error onto window
  // properties; we poll for either via waitForFunction.
  await page.evaluate(({ event }) => {
    const w = window as unknown as Record<string, unknown>;
    w.__TAURI_EVENT_RESULT__ = undefined;
    w.__TAURI_EVENT_ERROR__ = undefined;
    w.__TAURI_EVENT_REGISTERED__ = false;
    // @ts-ignore — Tauri internals
    const internals = window.__TAURI_INTERNALS__;
    internals.event
      .listen(event, (e: { payload: unknown }) => {
        w.__TAURI_EVENT_RESULT__ = { value: e.payload };
      })
      .then(() => {
        w.__TAURI_EVENT_REGISTERED__ = true;
      })
      .catch((err: unknown) => {
        w.__TAURI_EVENT_ERROR__ = String(err);
      });
  }, { event });

  // Phase 2: barrier — wait for registration to complete or fail.
  await page.waitForFunction(
    () => {
      const w = window as unknown as Record<string, unknown>;
      return w.__TAURI_EVENT_REGISTERED__ === true || typeof w.__TAURI_EVENT_ERROR__ === "string";
    },
    undefined,
    { timeout: 2_000 },
  );

  // Surface registration errors explicitly.
  const regError = await page.evaluate(
    () => (window as unknown as { __TAURI_EVENT_ERROR__?: string }).__TAURI_EVENT_ERROR__,
  );
  if (regError) {
    throw new Error(`waitForTauriEvent registration failed: ${regError}`);
  }

  // Phase 3: invoke trigger now that listener is live.
  await trigger();

  // Phase 4: poll for result.
  await page.waitForFunction(
    () => {
      const w = window as unknown as Record<string, unknown>;
      return w.__TAURI_EVENT_RESULT__ !== undefined;
    },
    undefined,
    { timeout: timeoutMs },
  );

  // Phase 5: extract and return payload.
  const result = await page.evaluate(
    () => (window as unknown as { __TAURI_EVENT_RESULT__?: { value: unknown } }).__TAURI_EVENT_RESULT__,
  );
  return (result as { value: T }).value;
}

export { test };
export { expect } from "@playwright/test";
