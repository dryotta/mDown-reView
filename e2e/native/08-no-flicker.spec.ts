import { test, expect } from "@playwright/test";
import { spawnAppWithCdp } from "./global-setup";
import { chromium, type Page, type Browser } from "@playwright/test";
import { spawnSync, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Flicker regression test (issue #265 / PR4).
 *
 * Pre-fix behaviour (root cause): the WebView2 host paints its
 * background white before the React bundle parses, then app.css's
 * dark-theme tokens flip the page once `<html data-theme="dark">` is
 * applied by `useApplyTheme`'s effect. The visible artefact is a
 * single-frame white flash on cold launch in dark mode (the
 * far-more-common case — system default and explicit dark both
 * resolve to dark on most dev machines).
 *
 * The fix has three layers, all of which this test exercises:
 *
 *   1. `tauri.conf.json` — main window `backgroundColor: "#0d1117"`
 *      so the OS-rendered window paints dark before the webview is
 *      even loaded.
 *   2. `index.html` — inline `<style>` setting `<html>` and `<body>`
 *      backgrounds to the dark token, plus an inline `<script>` that
 *      reads localStorage[`mdownreview-ui`].state.theme, resolves
 *      `system` → OS preference, and writes `data-theme` BEFORE the
 *      React bundle is fetched. Wrapped in try/catch — falls back to
 *      dark on parse errors.
 *   3. `useApplyTheme` hook — runs the same logic in React state,
 *      idempotent against the FOUC script (sets the same attribute
 *      to the same resolved value).
 *
 * Test method: launch the binary, sample
 * `getComputedStyle(document.documentElement).backgroundColor` at
 * 0/50/150/500ms post-window-ready. Assert no white frame in dark
 * mode, no dark frame in light mode. Assert `data-theme` is set on
 * the very first sample.
 *
 * Localizing the theme requires writing localStorage AFTER the page
 * loads (the FOUC script reads it on EACH launch). Tauri's WebView2
 * persists localStorage across CDP sessions for the same user-data
 * directory, so we set the theme on launch N, then re-launch (the
 * FOUC script picks up the persisted value). Light theme run is the
 * "second launch" pattern below.
 */

interface FrameSample {
  tMs: number;
  bgColor: string;
  dataTheme: string;
}

const SAMPLE_OFFSETS_MS = [0, 50, 150, 500];
// Match `--color-bg` tokens in src/styles/app.css.
const DARK_BG_RGB = "rgb(13, 17, 23)";
const LIGHT_BG_RGB = "rgb(255, 255, 255)";

async function killProcess(proc: ChildProcess): Promise<void> {
  if (!proc.pid) return;
  try {
    if (process.platform === "win32") {
      // First a graceful WM_CLOSE so WebView2 flushes localStorage to its
      // leveldb on the user-data folder — /F is TerminateProcess and
      // skips that flush, breaking cross-launch persistence in the
      // flicker test. Wait up to 3 s for clean exit, then force-kill.
      spawnSync("taskkill", ["/PID", String(proc.pid), "/T"], { stdio: "ignore" });
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline && proc.exitCode === null && proc.signalCode === null) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (proc.exitCode === null && proc.signalCode === null) {
        spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
      }
    } else {
      proc.kill("SIGTERM");
    }
  } catch {
    /* already dead */
  }
  // Give Windows a beat to release file locks before the next launch
  // reuses the same user-data folder.
  await new Promise((r) => setTimeout(r, 500));
}

async function attachToPage(
  cdpPort: number,
  deadlineMs: number
): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  let page: Page | undefined;
  // Find the app page (devUrl = http://localhost:1420). WebView2 may expose
  // about:blank or transient pages first, which deny localStorage access.
  while (Date.now() < deadlineMs) {
    for (const ctx of browser.contexts()) {
      for (const candidate of ctx.pages()) {
        const url = candidate.url();
        if (url.startsWith("http://localhost:1420")) {
          page = candidate;
          break;
        }
      }
      if (page) break;
    }
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) {
    await browser.close();
    throw new Error("No CDP page on devUrl after timeout");
  }
  // Wait for Tauri's JS bridge so localStorage / page.evaluate work
  // against the live document, not a navigation-in-progress.
  await page.waitForFunction(
    () => !!(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__,
    null,
    { timeout: Math.max(1000, deadlineMs - Date.now()) }
  );
  return { browser, page };
}

async function captureFrameSamples(page: Page): Promise<FrameSample[]> {
  // Wait for the Tauri bridge — closest analog to "window-ready" in the
  // log schema. Crucially, the page's <html> background should ALREADY
  // be set by the FOUC script before this resolves.
  await page.waitForFunction(
    () => !!(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__,
    null,
    { timeout: 15_000 }
  );

  // Capture all four frames in a single page.evaluate so the timer
  // baseline is consistent — round-tripping over CDP for each sample
  // would smear the early offsets across hundreds of ms.
  const samples: FrameSample[] = await page.evaluate(async (offsets: number[]) => {
    const start = performance.now();
    const out: Array<{ tMs: number; bgColor: string; dataTheme: string }> = [];
    for (const target of offsets) {
      const remaining = target - (performance.now() - start);
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, remaining));
      }
      const html = document.documentElement;
      out.push({
        tMs: Math.round(performance.now() - start),
        bgColor: getComputedStyle(html).backgroundColor,
        dataTheme: html.getAttribute("data-theme") ?? "",
      });
    }
    return out;
  }, SAMPLE_OFFSETS_MS);

  return samples;
}

async function setPersistedTheme(page: Page, theme: "light" | "dark" | "system"): Promise<void> {
  // Match the Zustand persist envelope — see src/store/index.ts:343.
  // Version 1 is the migrated shape; we set both fields the FOUC
  // script reads (state.theme).
  await page.evaluate((t: string) => {
    const payload = { state: { theme: t }, version: 1 };
    window.localStorage.setItem("mdownreview-ui", JSON.stringify(payload));
  }, theme);
  // Chromium debounces localStorage writes to leveldb; without a flush
  // trigger the value can sit in memory and be lost when the process
  // is killed. Navigating away fires beforeunload, which calls
  // LocalStorageImpl::ScheduleImmediateCommit and persists the write.
  await page.goto("about:blank").catch(() => {
    /* page may already be detached */
  });
}

test.describe("Flicker regression (issue #265)", () => {
  test.skip(process.platform !== "win32", "Native UI tests require Windows (WebView2 + CDP)");

  test("dark theme — no white frame in first 500ms", async () => {
    // Both spawns share a user-data folder so localStorage written in
    // launch #1 is visible to the FOUC script in launch #2.
    const sharedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdr-flicker-dark-"));
    let browser: Browser | null = null;
    try {
      const { appProc } = await spawnAppWithCdp({
        cdpPort: 9230,
        timeoutMs: 30_000,
        userDataDir: sharedDataDir,
      });
      try {
        // First launch: clear any persisted state so this run defaults
        // to system / dark (CI hosts default to dark; dev machines
        // may differ but we explicitly set dark below for stability).
        const { browser: b1, page } = await attachToPage(9230, Date.now() + 15_000);
        browser = b1;
        await page.evaluate(() => window.localStorage.removeItem("mdownreview-ui"));
        await setPersistedTheme(page, "dark");
      } finally {
        if (browser) await browser.close();
        await killProcess(appProc);
      }

      // Re-launch — the FOUC script reads the just-persisted theme.
      const { appProc: appProc2 } = await spawnAppWithCdp({
        cdpPort: 9231,
        timeoutMs: 30_000,
        userDataDir: sharedDataDir,
      });
      try {
        const { browser: b2, page } = await attachToPage(9231, Date.now() + 15_000);
        browser = b2;
        const samples = await captureFrameSamples(page);
        console.log(`[no-flicker] dark samples: ${JSON.stringify(samples)}`);

        // First sample must already have data-theme set (FOUC script ran).
        expect(samples[0].dataTheme).toBe("dark");
        // No white frame in any sample.
        for (const s of samples) {
          expect(s.bgColor, `sample at t=${s.tMs}ms had white background`).not.toBe(LIGHT_BG_RGB);
        }
      } finally {
        if (browser) await browser.close();
        await killProcess(appProc2);
      }
    } finally {
      try {
        fs.rmSync(sharedDataDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  test("light theme — no dark frame in first 500ms", async () => {
    const sharedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdr-flicker-light-"));
    let browser: Browser | null = null;
    try {
      const { appProc } = await spawnAppWithCdp({
        cdpPort: 9232,
        timeoutMs: 30_000,
        userDataDir: sharedDataDir,
      });
      try {
        const { browser: b1, page } = await attachToPage(9232, Date.now() + 15_000);
        browser = b1;
        await setPersistedTheme(page, "light");
      } finally {
        if (browser) await browser.close();
        await killProcess(appProc);
      }

      const { appProc: appProc2 } = await spawnAppWithCdp({
        cdpPort: 9233,
        timeoutMs: 30_000,
        userDataDir: sharedDataDir,
      });
      try {
        const { browser: b2, page } = await attachToPage(9233, Date.now() + 15_000);
        browser = b2;
        const samples = await captureFrameSamples(page);
        console.log(`[no-flicker] light samples: ${JSON.stringify(samples)}`);

        expect(samples[0].dataTheme).toBe("light");
        for (const s of samples) {
          expect(s.bgColor, `sample at t=${s.tMs}ms had dark background`).not.toBe(DARK_BG_RGB);
        }
      } finally {
        if (browser) await browser.close();
        await killProcess(appProc2);
      }
    } finally {
      try {
        fs.rmSync(sharedDataDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });
});
