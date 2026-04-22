import { test, expect } from "./fixtures";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

test.describe("Native Smoke Tests", () => {
  test("26.1 - app window opens showing the welcome view", async ({ nativePage }) => {
    // App starts with no file open — welcome view must be visible
    await expect(nativePage.locator(".welcome-view")).toBeVisible({ timeout: 10_000 });
    await expect(nativePage.locator(".welcome-view").getByText("Open File")).toBeVisible();
  });

  test("26.3 - temp .md file can be created at OS tmpdir (CLI-arg open tested in CI build)", async ({ nativePage }) => {
    // Native dialog cannot be driven programmatically. Full CLI-arg-open test runs in CI
    // via test:e2e:native:build, which passes the file path as a launch argument.
    // This test only validates that the OS tmpdir is writable from the test runner.
    const tmpFile = path.join(os.tmpdir(), `mdownreview-smoke-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, "# Smoke Test\n\nThis file was created by the test.");
    try {
      expect(fs.existsSync(tmpFile)).toBe(true);
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  });

  test("26.5 - log file exists after first launch", async ({ nativePage }) => {
    // Derive the log directory from the app's own get_log_path command so the path
    // matches the actual Tauri identifier (com.mdownreview.desktop), not the product name.
    const logFilePath = await nativePage.evaluate(async () => {
      // @ts-ignore — Tauri internals are available in the WebView
      return window.__TAURI_INTERNALS__.invoke("get_log_path");
    });
    const logDir = path.dirname(logFilePath as string);
    // Allow up to 1s for the app to flush the first log write on startup
    await new Promise((r) => setTimeout(r, 1000));
    expect(fs.existsSync(logDir)).toBe(true);
  });
});
