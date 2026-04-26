import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";


const CDP_PORT = 9222;
// Must match devUrl in src-tauri/tauri.conf.json
const VITE_PORT = 1420;
const PID_FILE = ".e2e-native.pid";

const BINARY_PATH =
  process.platform === "win32"
    ? path.join(process.cwd(), "src-tauri", "target", "debug", "mdownreview.exe")
    : path.join(process.cwd(), "src-tauri", "target", "debug", "mdownreview");

interface NativePids {
  vitePid?: number;
  appPid?: number;
}

function savePids(pids: NativePids): void {
  fs.writeFileSync(PID_FILE, JSON.stringify(pids));
}

/** Poll an HTTP endpoint until it responds with 2xx. */
async function waitForHttp(
  url: string,
  label: string,
  timeoutMs: number,
  isAlive?: () => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (isAlive && !isAlive()) {
      throw new Error(`[native-setup] ${label} process exited before becoming ready`);
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume(); // drain
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
        req.on("error", reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error("timeout"));
        });
      });
      return;
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(
    `[native-setup] ${label} at ${url} did not become ready within ${timeoutMs}ms (last error: ${lastError})`,
  );
}

async function waitForCdp(
  port: number,
  timeoutMs: number,
  isAlive: () => boolean,
): Promise<void> {
  // Wait for the CDP HTTP endpoint to respond — this confirms WebView2 has
  // started its DevTools server. The actual Playwright connection happens
  // in each test's fixture (connectOverCDP in fixtures.ts).
  console.log(`[native-setup] Waiting for CDP HTTP endpoint on port ${port}...`);
  await waitForHttp(
    `http://localhost:${port}/json/version`,
    "CDP HTTP",
    timeoutMs,
    isAlive,
  );
  console.log("[native-setup] CDP endpoint verified via HTTP.");
}

function spawnVite(): ChildProcess {
  // Resolve the Vite binary directly to avoid npx/cmd.exe wrapper orphan issues on Windows
  const viteBin = path.join(process.cwd(), "node_modules", ".bin", "vite");
  const viteCmd = process.platform === "win32" ? `${viteBin}.cmd` : viteBin;

  console.log(`[native-setup] Starting Vite dev server on port ${VITE_PORT}...`);
  const proc = spawn(viteCmd, ["--port", String(VITE_PORT), "--strictPort"], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    // On Windows, .cmd files need shell
    shell: process.platform === "win32",
  });

  proc.stdout?.on("data", (d: Buffer) =>
    process.stdout.write(`[vite] ${d}`),
  );
  proc.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[vite:err] ${d}`),
  );

  proc.once("exit", (code, signal) => {
    console.log(`[native-setup] Vite exited (code=${code}, signal=${signal})`);
  });

  return proc;
}

function spawnApp(): ChildProcess {
  console.log(`[native-setup] Launching binary: ${BINARY_PATH}`);
  const proc = spawn(BINARY_PATH, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  proc.stdout?.on("data", (d: Buffer) =>
    process.stdout.write(`[app] ${d}`),
  );
  proc.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[app:err] ${d}`),
  );

  proc.once("exit", (code, signal) => {
    console.log(`[native-setup] App exited (code=${code}, signal=${signal})`);
  });

  return proc;
}

export default async function globalSetup() {
  if (process.platform !== "win32") {
    console.log(
      "[native-setup] Non-Windows platform: skipping (CDP not supported on WKWebView)",
    );
    return;
  }

  // Clean up stale PID file from a crashed prior run
  if (fs.existsSync(PID_FILE)) {
    console.log("[native-setup] Found stale PID file, cleaning up...");
    try {
      const stale: NativePids = JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
      if (stale.appPid) {
        try { process.kill(stale.appPid, "SIGTERM"); } catch { /* already dead */ }
      }
      if (stale.vitePid) {
        try { process.kill(stale.vitePid, "SIGTERM"); } catch { /* already dead */ }
      }
    } catch { /* corrupt file, ignore */ }
    fs.unlinkSync(PID_FILE);
  }

  if (!fs.existsSync(BINARY_PATH)) {
    throw new Error(
      `[native-setup] Binary not found at ${BINARY_PATH}.\n` +
        `Run 'cd src-tauri && cargo build' first, or use 'npm run test:e2e:native:build'.`,
    );
  }

  // Step 1: Start Vite dev server (the debug binary loads frontend from devUrl)
  const viteProc = spawnVite();
  let viteAlive = true;
  viteProc.once("exit", () => { viteAlive = false; });
  savePids({ vitePid: viteProc.pid });

  console.log(`[native-setup] Vite spawned (pid ${viteProc.pid}), waiting for http://localhost:${VITE_PORT}...`);
  await waitForHttp(
    `http://localhost:${VITE_PORT}`,
    "Vite dev server",
    20_000,
    () => viteAlive,
  );
  console.log("[native-setup] Vite dev server ready.");

  // Step 2: Launch the Tauri binary with CDP enabled
  const appProc = spawnApp();
  let appAlive = true;
  appProc.once("exit", () => { appAlive = false; });
  savePids({ vitePid: viteProc.pid, appPid: appProc.pid });

  console.log(
    `[native-setup] App spawned (pid ${appProc.pid}), waiting for CDP on port ${CDP_PORT}...`,
  );
  await waitForCdp(CDP_PORT, 30_000, () => appAlive);
  console.log("[native-setup] CDP ready — all systems go.");
}

/**
 * Library export for non-Playwright callers (e.g., test-exploratory-e2e skill).
 * Spawns the binary with CDP enabled and resolves once the CDP HTTP endpoint
 * responds. Caller is responsible for killing `appProc` on teardown.
 *
 * Throws on non-Windows (matches `e2e/native/fixtures.ts:8` behaviour).
 */
export async function spawnAppWithCdp(opts?: {
  binaryPath?: string;
  cdpPort?: number;
  timeoutMs?: number;
}): Promise<{ appProc: ChildProcess; cdpPort: number }> {
  if (process.platform !== "win32") {
    throw new Error("spawnAppWithCdp requires Windows (WebView2 + CDP)");
  }
  const cdpPort = opts?.cdpPort ?? CDP_PORT;
  const binaryPath = opts?.binaryPath ?? BINARY_PATH;
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Binary not found at ${binaryPath}. Build first: 'cd src-tauri && cargo build'.`);
  }
  const appProc = spawn(binaryPath, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  let alive = true;
  appProc.once("exit", () => { alive = false; });
  await waitForCdp(cdpPort, opts?.timeoutMs ?? 30_000, () => alive);
  return { appProc, cdpPort };
}

export { waitForCdp };
