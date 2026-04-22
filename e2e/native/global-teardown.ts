import * as fs from "fs";

interface NativePids {
  vitePid?: number;
  appPid?: number;
}

function killPid(pid: number, label: string): void {
  try {
    process.kill(pid, "SIGTERM");
    console.log(`[native-teardown] Killed ${label} (pid ${pid})`);
  } catch {
    console.log(`[native-teardown] ${label} (pid ${pid}) already exited`);
  }
}

export default async function globalTeardown() {
  const pidFile = ".e2e-native.pid";
  if (!fs.existsSync(pidFile)) return;

  try {
    const pids: NativePids = JSON.parse(fs.readFileSync(pidFile, "utf8"));

    // Kill app first, then Vite
    if (pids.appPid) killPid(pids.appPid, "app");
    if (pids.vitePid) killPid(pids.vitePid, "Vite");
  } catch (e) {
    // Backward-compat: old format was just a bare PID number
    const raw = fs.readFileSync(pidFile, "utf8").trim();
    const pid = parseInt(raw, 10);
    if (!isNaN(pid)) killPid(pid, "binary (legacy pid file)");
  }

  fs.unlinkSync(pidFile);
  console.log("[native-teardown] Cleanup complete.");
}
