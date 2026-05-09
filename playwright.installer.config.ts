import { defineConfig } from "@playwright/test";

/**
 * Playwright config for the installer smoke spec only.
 *
 * Why a separate config file (and not a project in playwright.native.config.ts)?
 *   - `globalSetup` is **config-level, not per-project** in Playwright
 *     (https://playwright.dev/docs/api/class-testproject — TestProject has no
 *     `globalSetup` property; it only exists on TestConfig). A two-project
 *     split inside playwright.native.config.ts would still spawn one shared
 *     CDP-attached debug binary — exactly the cross-test contamination
 *     surface that issue #364 was about. A separate config file gives the
 *     installer spec its OWN globalSetup (none) so it cannot interfere with
 *     the rest of the suite.
 *
 *   - The installer spec runs silent NSIS install/uninstall via execSync at
 *     `e2e/native/installer.spec.ts:53,73`. The install/uninstall hits HKCU
 *     PATH and triggers WM_SETTINGCHANGE / SHCNE_ASSOCCHANGED broadcasts
 *     that race the running app's file-association registration, causing
 *     the shared debug binary to exit with code=1.
 *
 * Run via `npm run test:e2e:native:installer`. The default `npm run test:e2e:native`
 * deliberately excludes installer.spec.ts (see `playwright.native.config.ts`
 * `testIgnore`), so this config is the canonical entry point for the
 * installer smoke.
 */
export default defineConfig({
  testDir: "./e2e/native",
  testMatch: ["**/installer.spec.ts"],
  timeout: 600_000, // 10 minutes — install + uninstall round-trips
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: "html",
  // No globalSetup / globalTeardown — the installer spec spawns and tears
  // down the NSIS installer itself; no shared CDP-attached binary needed.
  projects: [
    {
      name: "native-installer",
      grep: process.platform === "win32" ? undefined : /^$/,
    },
  ],
});
