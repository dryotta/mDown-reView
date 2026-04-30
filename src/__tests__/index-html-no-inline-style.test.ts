/**
 * Regression test for `docs/security.md` rule 17a — index.html must contain
 * zero inline `<style>` elements so Tauri's `inject_nonce_token` does not add
 * a runtime nonce to `style-src` (which would, per CSP3 §6.7.2, ignore our
 * designed `'unsafe-inline'` and break Shiki/KaTeX/Mermaid/React inline-style
 * outputs in production). The inline `<script>` that synchronously sets
 * `[data-theme]` from localStorage MUST stay — Tauri SHA-256-hashes inline
 * scripts into `script-src` so it's allowed by the runtime CSP, and removing
 * it would re-introduce issue #265's first-paint flash.
 *
 * Parses the SOURCE `index.html` at the project root (NOT a built artefact)
 * with the test environment's built-in `DOMParser` (Vitest is configured for
 * a jsdom environment via `vitest.config.ts`, so `DOMParser` is on globalThis
 * and `@types/jsdom` does not need to be a project dependency just for this
 * test). Using a real parser ensures that the literal text `<style>` inside
 * the explanatory HTML comment does not produce a false positive —
 * `querySelectorAll('style')` walks parsed elements only, ignoring comment
 * nodes.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";

describe("index.html — CSP nonce-injection prevention (rule 17a)", () => {
  let parsedDocument: Document;

  beforeAll(() => {
    const indexHtml = readFileSync(
      resolve(__dirname, "..", "..", "index.html"),
      "utf-8",
    );
    parsedDocument = new DOMParser().parseFromString(indexHtml, "text/html");
  });

  it("contains zero <style> elements (Tauri nonce-injection trigger)", () => {
    const styleElements = parsedDocument.querySelectorAll("style");
    expect(styleElements.length).toBe(0);
  });

  it("retains the inline data-theme bootstrap script and writes [data-theme] before React mounts", () => {
    const inlineScripts = Array.from(
      parsedDocument.querySelectorAll<HTMLScriptElement>("script:not([src])"),
    );
    const themeBootstrap = inlineScripts.find((s) =>
      /localStorage\.getItem\(["']mdownreview-ui["']\)/.test(s.textContent ?? ""),
    );
    expect(
      themeBootstrap,
      "FOUC bootstrap script (issue #265) must remain in index.html — it sets [data-theme] synchronously from localStorage before the React module script executes; deleting it re-introduces the first-paint flash this scenario was designed to prevent",
    ).toBeDefined();
    expect(themeBootstrap?.textContent).toMatch(
      /setAttribute\(["']data-theme["']/,
    );
  });
});

/**
 * Build-output guard for `docs/security.md` rule 17a — the unit test on
 * source `index.html` (above) catches developers who add an inline `<style>`
 * to the source file, but it cannot catch a future Vite plugin /
 * `transformIndexHtml` hook / vendor SDK that injects a `<style>` element
 * into the bundled `dist/index.html` at build time. This second test parses
 * the BUILT artefact and asserts the same invariant. It is gated on
 * `dist/index.html` existing — if the working tree has not been built (e.g.
 * fresh checkout, `npm test` before `npm run build`), the test is SKIPPED so
 * unit-test runs do not require a full Vite build. CI runs `npm run build`
 * before `npm test`'s entry point only in the `release-gate.yml` flow; the
 * normal `ci.yml` ordering puts vitest before build, so this test will most
 * commonly skip on PR runs and execute on release-gate runs. That is
 * acceptable — the source-level test (above) is the primary fast-feedback
 * gate; this dist-level test is the slower-but-comprehensive backstop for
 * build-time injection vectors.
 */
describe("dist/index.html — CSP nonce-injection prevention (rule 17a, build-output)", () => {
  const distIndexPath = resolve(__dirname, "..", "..", "dist", "index.html");
  const distExists = (() => {
    try {
      readFileSync(distIndexPath, "utf-8");
      return true;
    } catch {
      return false;
    }
  })();

  describe.skipIf(!distExists)("when dist has been built", () => {
    let parsedDist: Document;

    beforeAll(() => {
      const html = readFileSync(distIndexPath, "utf-8");
      parsedDist = new DOMParser().parseFromString(html, "text/html");
    });

    it("contains zero <style> elements in the built artefact (catches build-time injection)", () => {
      const styleElements = parsedDist.querySelectorAll("style");
      expect(styleElements.length).toBe(0);
    });
  });
});
