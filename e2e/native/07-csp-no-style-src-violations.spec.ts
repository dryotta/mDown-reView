/**
 * Regression test for `docs/security.md` rule 17a — production CSP must
 * not produce `style-src` violations when rendering Shiki-highlighted code
 * blocks.
 *
 * This is the ONLY test layer that exercises the real Tauri-injected CSP:
 * - Vitest/jsdom does not enforce CSP at all.
 * - Vite dev server (browser e2e) does not apply Tauri's runtime nonce.
 * - Only the real Tauri binary serves the production CSP via the response
 *   header path (`tauri::manager::set_csp`).
 *
 * Failure mode the test is designed to catch: a future commit re-introduces
 * an inline `<style>` element in `index.html` (or any HTML asset Tauri
 * serves), which causes `inject_nonce_token` to append a fresh nonce to
 * `style-src` at runtime, which (per CSP3 §6.7.2) ignores the configured
 * `'unsafe-inline'` and blocks every Shiki/KaTeX/Mermaid/React inline-style
 * attribute. The test installs a `securitypolicyviolation` listener on the
 * page, opens a fixture markdown with a fenced TS code block, waits for
 * Shiki to render, and asserts zero `style-src`-prefixed violations were
 * captured.
 */
import { test, expect, setRootViaTest } from "./fixtures";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

test.describe("Native CSP — no style-src violations on Shiki render (rule 17a)", () => {
  test("32.1 - opening a fenced-code markdown in the real binary produces zero style-src CSP violations", async ({
    nativePage,
  }) => {
    const tmpDir = path.join(os.tmpdir(), `mdownreview-csp-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, "code-block.md");
    fs.writeFileSync(
      tmpFile,
      [
        "# CSP Shiki regression",
        "",
        "```typescript",
        'const greeting: string = "Hello, world!";',
        "export function greet(name: string): string {",
        "  return `Hello, ${name}!`;",
        "}",
        "console.log(greet(greeting));",
        "```",
        "",
      ].join("\n"),
    );

    try {
      // Reset persisted store so we always open the fixture fresh, then
      // reload to drop any leftover tabs/activeTabPath that a previous
      // test in the suite may have persisted.
      await nativePage.evaluate(() =>
        localStorage.removeItem("mdownreview-ui"),
      );
      await nativePage.reload();
      await nativePage.waitForFunction(
        () => !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
        null,
        { timeout: 15_000 },
      );

      // Install the violation listener AFTER reload — the previous page
      // context (and any prior listener) is gone. We attach BEFORE
      // setRootViaTest so the listener is in place before any DOM
      // mutation that would trigger Shiki tokens.
      //
      // Note on `addInitScript`: it's not used here because the fixture
      // connects to an already-running Tauri WebView via `connectOverCDP`
      // rather than launching a fresh browser context. `addInitScript`
      // installs on future navigations of contexts Playwright owns; on a
      // CDP-attached existing context the timing is unreliable and
      // explicit post-reload `evaluate` is the clearer contract.
      await nativePage.evaluate(() => {
        const w = globalThis as unknown as {
          __cspViolations: Array<{
            violatedDirective: string;
            blockedURI: string;
            sourceFile: string;
            sample: string;
          }>;
        };
        w.__cspViolations = [];
        document.addEventListener("securitypolicyviolation", (event) => {
          const e = event as SecurityPolicyViolationEvent;
          w.__cspViolations.push({
            violatedDirective: e.violatedDirective,
            blockedURI: e.blockedURI,
            sourceFile: e.sourceFile,
            sample: e.sample,
          });
        });
      });

      // Open the fixture folder; setRootViaTest auto-opens the first file.
      await setRootViaTest(nativePage, tmpDir);

      // Wait for the markdown viewer to mount.
      await expect(nativePage.locator(".markdown-viewer")).toBeVisible({
        timeout: 10_000,
      });

      // Wait for Shiki to finish rendering the code block. The
      // <pre class="shiki"> wrapper appears once highlighting completes;
      // its absence after a generous timeout indicates Shiki failed.
      await expect(nativePage.locator("pre.shiki")).toBeVisible({
        timeout: 15_000,
      });

      // Give a small grace period for any async violations to fire after
      // the highlight completes (Shiki can stream additional spans).
      await nativePage.waitForTimeout(500);

      // Read collected violations.
      const violations = await nativePage.evaluate(
        () =>
          (
            globalThis as unknown as {
              __cspViolations: Array<{
                violatedDirective: string;
                blockedURI: string;
                sourceFile: string;
                sample: string;
              }>;
            }
          ).__cspViolations,
      );

      const styleSrcViolations = violations.filter((v) =>
        v.violatedDirective.startsWith("style-src"),
      );

      expect(
        styleSrcViolations,
        `Expected zero style-src violations, but got: ${JSON.stringify(
          styleSrcViolations,
          null,
          2,
        )}`,
      ).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
