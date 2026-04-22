import { defineConfig } from "@playwright/test";

const CDP_PORT = 9222;

export default defineConfig({
  testDir: "./e2e/native",
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
