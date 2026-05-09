import { defineConfig } from "@playwright/test";

const CDP_PORT = 9222;

/**
 * Playwright config for the native (CDP-attached debug binary) E2E suite.
 *
 * Two-config layout (issue #364 — see e2e/native/README.md):
 *   - playwright.native.config.ts (this file): every spec EXCEPT installer.
 *     Spawns one shared CDP-attached debug binary via globalSetup, runs
 *     specs serially against it.
 *   - playwright.installer.config.ts: installer.spec.ts only. No
 *     globalSetup — the installer spec spawns/tears down its own NSIS
 *     binary and would kill any shared debug binary if co-located here.
 *
 * Run via `npm run test:e2e:native` (this config) or
 * `npm run test:e2e:native:installer` (the other config).
 */
export default defineConfig({
  testDir: "./e2e/native",
  testIgnore: ["**/installer.spec.ts"],
  timeout: 60_000,
  retries: 0,
  // All tests share a single app window — must run serially
  workers: 1,
  // Enforce alphabetical file order (smoke → ipc → file-reload progression)
  fullyParallel: false,
  reporter: "html",
  globalSetup: "./e2e/native/global-setup.ts",
  globalTeardown: "./e2e/native/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${CDP_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "native-windows",
      grep: process.platform === "win32" ? undefined : /^$/,
    },
  ],
});
