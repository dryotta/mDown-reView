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

  it("retains the inline data-theme bootstrap script (FOUC contract for issue #265)", () => {
    const inlineScripts = Array.from(
      parsedDocument.querySelectorAll<HTMLScriptElement>("script:not([src])"),
    );
    const themeBootstrap = inlineScripts.find((s) =>
      /localStorage\.getItem\(["']mdownreview-ui["']\)/.test(s.textContent ?? ""),
    );
    expect(themeBootstrap).toBeDefined();
  });

  it("the bootstrap script writes [data-theme] before React mounts", () => {
    const inlineScripts = Array.from(
      parsedDocument.querySelectorAll<HTMLScriptElement>("script:not([src])"),
    );
    const themeBootstrap = inlineScripts.find((s) =>
      /localStorage\.getItem\(["']mdownreview-ui["']\)/.test(s.textContent ?? ""),
    );
    expect(themeBootstrap?.textContent).toMatch(
      /setAttribute\(["']data-theme["']/,
    );
  });
});
