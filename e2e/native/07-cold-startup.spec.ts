import { test, expect } from "@playwright/test";
import { spawnAppWithCdp } from "./global-setup";
import { chromium, type Page, type Browser } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
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
 * only fail if it's > 3x the release target). The doc rule cited in
 * `docs/performance.md` (rule N) names this file as the canonical
 * gate.
 *
 * `mdownreview-cli` is still invoked elsewhere (release CI uses the
 * `--phase-budget` flag) so the test skips when it isn't built.
 */

const ITERATIONS = 5;
const FRONTEND_MOUNTED_BUDGET_MS = 800;
const DEBUG_BUILD_MULTIPLIER = 3;

interface LaunchResult {
  frontendMountedMs: number;
  appInitMs: number;
}

function locateCliBinary(): string {
  const ext = process.platform === "win32" ? ".exe" : "";
  const staged = path.join(
    process.cwd(),
    "src-tauri",
    "binaries",
    `mdownreview-cli${process.platform === "win32" ? "-x86_64-pc-windows-msvc.exe" : ext}`
  );
  if (fs.existsSync(staged)) return staged;
  // Fall back to the cargo-built binary (debug build in target/debug).
  const debug = path.join(process.cwd(), "src-tauri", "target", "debug", `mdownreview-cli${ext}`);
  return debug;
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

async function singleLaunch(cdpPort: number): Promise<LaunchResult | null> {
  // Sharing the runtime log file with the persistent harness binary on
  // port 9222 introduced file-locking races on Windows that swallowed
  // the spawned binary's writes silently. Read the [startup] phases
  // straight off the spawned process's stdout instead — debug builds
  // emit them via the Stdout target (lib.rs::run) so this is the same
  // data analyze-log would parse, without crossing a shared file.
  const { appProc } = await spawnAppWithCdp({ cdpPort, timeoutMs: 30_000 });
  let stdoutBuf = "";
  appProc.stdout?.on("data", (d: Buffer) => {
    stdoutBuf += d.toString("utf8");
  });

  const deadline = Date.now() + 15_000;
  let captured: { appInit: number; frontendMounted: number } | null = null;
  let browser: Browser | null = null;
  try {
    // Connect over CDP so React has a window to mount into.
    browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
    let page: Page | undefined;
    while (Date.now() < deadline) {
      const ctxs = browser.contexts();
      if (ctxs.length > 0) {
        const pages = ctxs[0].pages();
        if (pages.length > 0) {
          page = pages[0];
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!page) throw new Error("No CDP page after 15 s");

    // Wait for Tauri JS bridge — proxy for webview-ready.
    await page.waitForFunction(
      () => !!(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__,
      null,
      { timeout: 15_000 }
    );

    while (Date.now() < deadline) {
      const phases = parseStartupPhases(stdoutBuf);
      const ai = phases.get("app-init");
      const fm = phases.get("frontend-mounted");
      if (ai !== undefined && fm !== undefined) {
        captured = { appInit: ai, frontendMounted: fm };
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    if (browser) await browser.close();
    await killProcess(appProc);
  }

  if (!captured) return null;
  return {
    appInitMs: captured.appInit,
    frontendMountedMs: captured.frontendMounted,
  };
}

test.describe("Cold startup bench (issue #265)", () => {
  test.skip(process.platform !== "win32", "Native UI tests require Windows (WebView2 + CDP)");

  test("frontend-mounted t_ms p95 budget across 5 cold launches", async () => {
    const cliPath = locateCliBinary();
    if (!fs.existsSync(cliPath)) {
      test.skip(
        true,
        `mdownreview-cli not built at ${cliPath} — run scripts/stage-cli.mjs or cargo build`
      );
      return;
    }
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
        `[cold-startup] iter ${i}: app-init=${result.appInitMs}ms frontend-mounted=${result.frontendMountedMs}ms`
      );
    }

    const sorted = measurements.map((m) => m.frontendMountedMs).sort((a, b) => a - b);
    // Nearest-rank p95 over n=5 → index ceil(0.95*5)-1 = 4 → max value.
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];

    console.log(`[cold-startup] frontend-mounted p95 = ${p95}ms (samples: ${sorted.join(", ")})`);

    // Debug builds run unoptimized code; loosen the assertion so the
    // gate doesn't false-positive on local dev runs against
    // `cargo build` (no --release). Release CI builds tighten this
    // back to FRONTEND_MOUNTED_BUDGET_MS via the analyze-log
    // --phase-budget flag (also wired into this same spec for CI).
    const isReleaseBuild = process.env.MDR_E2E_RELEASE_BUILD === "1";
    const effectiveBudget = isReleaseBuild
      ? FRONTEND_MOUNTED_BUDGET_MS
      : FRONTEND_MOUNTED_BUDGET_MS * DEBUG_BUILD_MULTIPLIER;

    expect(p95).toBeLessThanOrEqual(effectiveBudget);
  });
});
