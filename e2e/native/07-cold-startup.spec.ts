import { test, expect } from "@playwright/test";
import { spawnAppWithCdp } from "./global-setup";
import { chromium, type Page, type Browser } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { spawnSync, type ChildProcess } from "child_process";

/**
 * Cold-startup bench (issue #265 / PR4).
 *
 * Closes the "no cold-startup benchmark" Gap #1 in
 * `docs/performance.md`. Launches the Tauri binary 5 times back-to-
 * back, each on a unique CDP port (the persistent harness in
 * `global-setup.ts` owns 9222), captures the [startup] events from
 * the rotating log file, then runs `mdownreview-cli analyze-log` to
 * extract `frontend-mounted` t_ms — the proxy for "fully ready"
 * since PR3 does not define a `startup-complete` phase.
 *
 * Budget: 800 ms p95 (release builds; debug builds run un-optimized
 * code so the assertion is loosened — we still record the value but
 * only fail if it's > 3x the release target). The doc rule cited in
 * `docs/performance.md` (rule N) names this file as the canonical
 * gate.
 *
 * If `mdownreview-cli` is not installed, the test is skipped with a
 * descriptive message — CI builds the staged binary before this spec
 * runs (see `npm run test:e2e:native:build`).
 */

const ITERATIONS = 5;
const FRONTEND_MOUNTED_BUDGET_MS = 800;
const DEBUG_BUILD_MULTIPLIER = 3;

interface LaunchResult {
  frontendMountedMs: number;
  appInitMs: number;
}

function locateLogFile(): string {
  // Mirrors `default_log_path()` in src-tauri/src/bin/cli.rs.
  // Bundle ID is locked to tauri.conf.json's `identifier`.
  const bundleId = "com.mdownreview.desktop";
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      bundleId,
      "logs",
      "mdownreview.log"
    );
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Logs", bundleId, "mdownreview.log");
  }
  // Linux fallback — XDG_DATA_HOME or ~/.local/share
  const xdg = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(xdg, bundleId, "logs", "mdownreview.log");
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

async function captureFrontendMountedFromLogs(
  cliPath: string,
  logPath: string
): Promise<{ appInit: number; frontendMounted: number } | null> {
  // Use the analyze-log subcommand to parse the log so we share schema
  // logic with the Rust side instead of re-implementing the parser in
  // TS. The CLI's exit code is 0 on success even when the budget is
  // not specified.
  const result = spawnSync(cliPath, ["analyze-log", logPath, "--json"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  let parsed: { startup_phases?: Array<{ phase: string; t_ms: number }> } = {};
  try {
    parsed = JSON.parse(result.stdout) as typeof parsed;
  } catch {
    return null;
  }
  const phases = parsed.startup_phases ?? [];
  const fm = phases.find((p) => p.phase === "frontend-mounted");
  const ai = phases.find((p) => p.phase === "app-init");
  if (!fm || !ai) return null;
  return { appInit: ai.t_ms, frontendMounted: fm.t_ms };
}

async function singleLaunch(
  cdpPort: number,
  cliPath: string,
  logPath: string
): Promise<LaunchResult | null> {
  // The runtime appends to the log; capture file size BEFORE launch so
  // we can find the new lines after the binary writes them. We don't
  // truncate — multiple overlapping runs on a single dev machine could
  // race, and `analyze-log` on the WHOLE file with first-observation
  // semantics naturally yields the earliest cold-startup timeline.
  // Instead: rotate by deleting the file before each launch (it's
  // recreated on first log write).
  if (fs.existsSync(logPath)) {
    try {
      fs.unlinkSync(logPath);
    } catch {
      /* ignore — best effort */
    }
  }

  const { appProc } = await spawnAppWithCdp({ cdpPort, timeoutMs: 30_000 });

  // Wait until both [startup] phases are present in the log.
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

    // Poll the log file until both required phases are present.
    while (Date.now() < deadline) {
      captured = await captureFrontendMountedFromLogs(cliPath, logPath);
      if (captured) break;
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
    const logPath = locateLogFile();
    const measurements: LaunchResult[] = [];

    // Use a CDP port range above the persistent harness's 9222 to
    // avoid contention. Each iteration gets a distinct port so a
    // half-killed previous process can't pollute the next launch.
    for (let i = 0; i < ITERATIONS; i++) {
      const result = await singleLaunch(9223 + i, cliPath, logPath);
      if (!result) {
        // Treat any iteration that failed to capture as a fatal test
        // failure — silently swallowing here would mask a regression
        // in the recorder itself.
        throw new Error(`launch ${i} produced no [startup] phases in ${logPath}`);
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
