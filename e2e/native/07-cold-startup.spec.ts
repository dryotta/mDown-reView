import { test, expect } from "@playwright/test";
import { spawnAppWithCdp } from "./global-setup";
import { chromium, type Page, type Browser } from "@playwright/test";
import { spawnSync, type ChildProcess } from "child_process";

/**
 * Cold-startup bench (issue #265 / PR4).
 *
 * Closes the "no cold-startup benchmark" Gap #1 in
 * `docs/performance.md`. Launches the Tauri binary 5 times back-to-
 * back, each on a unique CDP port (the persistent harness in
 * `global-setup.ts` owns 9222) and reads the `[startup]` phase
 * events directly from the spawned process's stdout — debug builds
 * emit them via the Stdout target in `lib.rs::run`. Reading from a
 * shared log file races with the persistent harness on Windows, so
 * stdout is the single source of truth here.
 *
 * Budget: 800 ms p95 (release builds; debug builds run un-optimized
 * code so the assertion is loosened — we still record the value but
 * only fail if it's > 3x the release target).
 */

const ITERATIONS = 5;
const FRONTEND_MOUNTED_BUDGET_MS = 800;
// Per-step deadline, not a single 15 s shared across CDP attach +
// bridge wait + phase capture — a slow CI runner where the bridge
// appears at ~13 s would otherwise leave no budget for stdout polling
// and false-fail the bench on iteration 0.
const STEP_TIMEOUT_MS = 30_000;

interface LaunchResult {
  appInitMs: number;
  webviewReadyMs: number;
  frontendMountedMs: number;
}

async function killProcess(proc: ChildProcess): Promise<void> {
  if (!proc.pid) return;
  try {
    if (process.platform === "win32") {
      // Windows: graceful taskkill, then force after a short grace.
      spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      proc.kill("SIGTERM");
    }
  } catch {
    /* already dead */
  }
  // Give the OS a moment to release ports / file handles.
  await new Promise((r) => setTimeout(r, 500));
}

// Pattern: `[startup] phase=<kebab-name> t_ms=<int>` — defined in
// src-tauri/src/startup_recorder.rs and stable across PR3+ runtimes.
const STARTUP_PHASE_RE = /\[startup\]\s+phase=([\w-]+)\s+t_ms=(\d+)/g;

function parseStartupPhases(buffer: string): Map<string, number> {
  const phases = new Map<string, number>();
  let match: RegExpExecArray | null;
  STARTUP_PHASE_RE.lastIndex = 0;
  while ((match = STARTUP_PHASE_RE.exec(buffer)) !== null) {
    // First-observation wins so the timeline reflects this cold launch
    // rather than late re-emits.
    if (!phases.has(match[1])) {
      phases.set(match[1], Number(match[2]));
    }
  }
  return phases;
}

async function findAppPage(browser: Browser, deadlineMs: number): Promise<Page | undefined> {
  while (Date.now() < deadlineMs) {
    for (const ctx of browser.contexts()) {
      const pages = ctx.pages();
      if (pages.length > 0) return pages[0];
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return undefined;
}

async function singleLaunch(cdpPort: number): Promise<LaunchResult | null> {
  // Sharing the runtime log file with the persistent harness binary on
  // port 9222 introduced file-locking races on Windows that swallowed
  // the spawned binary's writes silently. Read the [startup] phases
  // straight off the spawned process's stdout instead — debug builds
  // emit them via the Stdout target (lib.rs::run). `getStdout` returns
  // the buffer accumulated from spawn time so the early phases
  // (app-init, webview-ready) which fire before `spawnAppWithCdp`
  // resolves are still visible.
  const { appProc, getStdout } = await spawnAppWithCdp({ cdpPort, timeoutMs: STEP_TIMEOUT_MS });

  let captured: LaunchResult | null = null;
  let browser: Browser | null = null;
  try {
    // Each step gets its own deadline so a slow webview / cold runner
    // doesn't starve the downstream phase-capture poll.
    browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
    const page = await findAppPage(browser, Date.now() + STEP_TIMEOUT_MS);
    if (!page) throw new Error(`No CDP page after ${STEP_TIMEOUT_MS} ms`);

    // Wait for Tauri JS bridge — proxy for webview-ready.
    await page.waitForFunction(
      () => !!(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__,
      null,
      { timeout: STEP_TIMEOUT_MS }
    );

    const phaseDeadline = Date.now() + STEP_TIMEOUT_MS;
    while (Date.now() < phaseDeadline) {
      const phases = parseStartupPhases(getStdout());
      const ai = phases.get("app-init");
      const wr = phases.get("webview-ready");
      const fm = phases.get("frontend-mounted");
      if (ai !== undefined && wr !== undefined && fm !== undefined) {
        captured = { appInitMs: ai, webviewReadyMs: wr, frontendMountedMs: fm };
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    if (browser) await browser.close();
    await killProcess(appProc);
  }

  return captured;
}

test.describe("Cold startup bench (issue #265)", () => {
  test.skip(process.platform !== "win32", "Native UI tests require Windows (WebView2 + CDP)");

  test("frontend-mounted t_ms p95 budget across 5 cold launches", async () => {
    const measurements: LaunchResult[] = [];

    // Use a CDP port range above the persistent harness's 9222 to
    // avoid contention. Each iteration gets a distinct port so a
    // half-killed previous process can't pollute the next launch.
    for (let i = 0; i < ITERATIONS; i++) {
      const result = await singleLaunch(9223 + i);
      if (!result) {
        // Treat any iteration that failed to capture as a fatal test
        // failure — silently swallowing here would mask a regression
        // in the recorder itself.
        throw new Error(`launch ${i} produced no [startup] phases on stdout`);
      }
      measurements.push(result);
      console.log(
        `[cold-startup] iter ${i}: app-init=${result.appInitMs}ms webview-ready=${result.webviewReadyMs}ms frontend-mounted=${result.frontendMountedMs}ms`
      );
      // Phase-order invariant — `app-init` is the first instruction in
      // `lib.rs::run`, `webview-ready` fires when the main webview's
      // window is created, `frontend-mounted` after React's first
      // effect. A regression that inverts the order would silently
      // pass the budget gate without this check.
      expect(
        result.appInitMs,
        `iter ${i}: app-init should precede webview-ready`
      ).toBeLessThanOrEqual(result.webviewReadyMs);
      expect(
        result.webviewReadyMs,
        `iter ${i}: webview-ready should precede frontend-mounted`
      ).toBeLessThanOrEqual(result.frontendMountedMs);
    }

    const sorted = measurements.map((m) => m.frontendMountedMs).sort((a, b) => a - b);
    // Nearest-rank p95 over n=5 → index ceil(0.95*5)-1 = 4 → max value.
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];

    console.log(`[cold-startup] frontend-mounted p95 = ${p95}ms (samples: ${sorted.join(", ")})`);

    // Debug builds run unoptimized code; loosen the assertion 3× so
    // the gate doesn't false-positive on local dev runs against
    // `cargo build` (no --release). Release CI sets
    // MDR_E2E_RELEASE_BUILD=1 to enforce the un-multiplied target.
    const isReleaseBuild = process.env.MDR_E2E_RELEASE_BUILD === "1";
    const effectiveBudget = isReleaseBuild
      ? FRONTEND_MOUNTED_BUDGET_MS
      : FRONTEND_MOUNTED_BUDGET_MS * 3;

    expect(p95).toBeLessThanOrEqual(effectiveBudget);
  });
});
