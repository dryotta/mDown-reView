import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

// Real-installer smoke. Windows-only — the produced artifact is a Windows NSIS
// .exe, and PATH manipulation hits HKCU\Environment which only exists on
// Windows. Skipping on macOS / Linux runners keeps the suite green there.
test.skip(process.platform !== "win32", "Windows-only installer test");
// CI `installer-e2e` job sets MDR_INSTALLER_PATH to a downloaded build
// artefact and runs this spec against it. When MDR_INSTALLER_PATH is set,
// MDR_NATIVE_SKIP_INSTALLER is ignored — an explicit path is a stronger
// signal than the legacy skip flag. Set MDR_NATIVE_SKIP_INSTALLER=0 (or
// unset) plus no MDR_INSTALLER_PATH to run locally against a freshly built
// bundle.
test.skip(
  process.env.MDR_NATIVE_SKIP_INSTALLER === "1" &&
    !process.env.MDR_INSTALLER_PATH,
  "installer skipped — set MDR_INSTALLER_PATH to run against a downloaded artefact",
);

function readUserPath(): string {
  return execSync(
    `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('PATH','User')"`,
    { encoding: "utf8" },
  ).trim();
}

test("NSIS installer adds and removes per-user PATH cleanly", async () => {
  // Two resolution paths:
  //  1. CI: `installer-e2e` job downloads the build artefact and points
  //     MDR_INSTALLER_PATH at the .exe directly. Avoids a ~10-min rebuild.
  //  2. Local: scan the Tauri bundle output dirs (per-target + default).
  let installerPath: string;
  if (process.env.MDR_INSTALLER_PATH) {
    installerPath = path.resolve(process.env.MDR_INSTALLER_PATH);
    if (!fs.existsSync(installerPath)) {
      throw new Error(
        `MDR_INSTALLER_PATH=${installerPath} does not exist`,
      );
    }
  } else {
    const candidateDirs = [
      path.resolve("src-tauri/target/release/bundle/nsis"),
      path.resolve("src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis"),
      path.resolve("src-tauri/target/aarch64-pc-windows-msvc/release/bundle/nsis"),
    ];
    const bundleDir = candidateDirs.find((d) => fs.existsSync(d));
    if (!bundleDir) {
      throw new Error(
        `No NSIS bundle dir found. Looked in:\n  ${candidateDirs.join("\n  ")}`,
      );
    }
    const installer = fs.readdirSync(bundleDir).find((f) => f.endsWith(".exe"));
    if (!installer) throw new Error(`No NSIS installer .exe in ${bundleDir}`);
    installerPath = path.join(bundleDir, installer);
  }
  const installPrefix = path.join(
    process.env.TEMP ?? "C:\\Windows\\Temp",
    `mdr-test-${Date.now()}`,
  );

  // Capture PATH before
  const pathBefore = readUserPath();
  const beforeSegments = new Set(pathBefore.split(";").filter(Boolean));

  // Silent install. /S = silent, /D=... must be the LAST argument (NSIS quirk)
  // and must NOT be quoted.
  execSync(`"${installerPath}" /S /D=${installPrefix}`, { stdio: "inherit" });

  try {
    // Capture PATH from a fresh process so we read the persisted HKCU value.
    const pathAfterInstall = readUserPath();
    const afterSegments = new Set(pathAfterInstall.split(";").filter(Boolean));

    expect(pathAfterInstall).toContain(installPrefix);

    // Every segment present before install must still be present (no corruption).
    for (const seg of beforeSegments) {
      expect(
        afterSegments.has(seg),
        `segment lost during install: ${seg}`,
      ).toBe(true);
    }
  } finally {
    // Always uninstall, even if assertions failed, so we don't leak PATH state.
    const uninstaller = path.join(installPrefix, "uninstall.exe");
    if (fs.existsSync(uninstaller)) {
      execSync(`"${uninstaller}" /S`, { stdio: "inherit" });
    }
  }

  const pathAfterUninstall = readUserPath();
  const afterUninstallSegments = new Set(
    pathAfterUninstall.split(";").filter(Boolean),
  );
  expect(
    afterUninstallSegments.has(installPrefix),
    `install dir not removed from PATH after uninstall`,
  ).toBe(false);
  for (const seg of beforeSegments) {
    expect(
      afterUninstallSegments.has(seg),
      `segment lost during uninstall: ${seg}`,
    ).toBe(true);
  }
});
