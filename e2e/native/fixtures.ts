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
    const [context] = browser.contexts();
    const [page] = context.pages();
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
