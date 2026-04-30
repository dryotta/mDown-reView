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

export { test };
export { expect } from "@playwright/test";
