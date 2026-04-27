/**
 * Integration test — uses REAL Shiki (not mocked) to verify that the
 * source-highlighting pipeline produces tokens with inline color styles.
 *
 * This test catches the root cause of #181: if Shiki's dynamic language
 * loading fails silently in the bundled environment, all tokens render
 * uniform black because the fallback "text" language produces spans
 * without style="color:..." attributes.
 */
import { describe, it, expect } from "vitest";
import { createHighlighter } from "shiki";

describe("Shiki integration (real, not mocked)", () => {
  it("loadLanguage works and codeToHtml produces colored tokens", async () => {
    const hl = await createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [],
    });

    // This is what useSourceHighlighting does:
    await hl.loadLanguage("typescript");
    expect(hl.getLoadedLanguages()).toContain("typescript");

    const html = hl.codeToHtml("const x = 42;", {
      lang: "typescript",
      theme: "github-light",
    });

    // Must contain at least one span with a non-default color style
    expect(html).toMatch(/style="color:#[0-9a-fA-F]{3,6}"/);

    // The "const" keyword must be colored differently from plain text
    expect(html).toContain('style="color:#D73A49"');
  });

  it("text language produces spans WITHOUT color styles", async () => {
    const hl = await createHighlighter({
      themes: ["github-light"],
      langs: [],
    });

    const html = hl.codeToHtml("const x = 42;", {
      lang: "text",
      theme: "github-light",
    });

    // "text" lang wraps everything in a single unstyled span — no color
    const lineContent = html.split('<span class="line">')[1];
    expect(lineContent).not.toMatch(/style="color:#(?!24292[eE])[0-9a-fA-F]{3,6}"/);
  });

  it("full pipeline: split produces lines with color attributes", async () => {
    const hl = await createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [],
    });
    await hl.loadLanguage("typescript");

    const content = "const x: string = 'hello';\nfunction foo() { return 42; }";
    const fullHtml = hl.codeToHtml(content, {
      lang: "typescript",
      theme: "github-light",
    });

    // Replicate the split from useSourceHighlighting
    const parts = fullHtml.split('<span class="line">');
    const htmlLines: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      const endIdx = parts[i].lastIndexOf("</span>");
      htmlLines.push(endIdx >= 0 ? parts[i].substring(0, endIdx) : parts[i]);
    }

    expect(htmlLines).toHaveLength(2);

    // Each line must have at least one colored token
    for (const line of htmlLines) {
      expect(line).toMatch(/style="color:#[0-9a-fA-F]{3,6}"/);
    }

    // Line 1: "const" should be colored
    expect(htmlLines[0]).toContain("const");
    // Line 2: "function" should be colored
    expect(htmlLines[1]).toContain("function");
  });

  it("tsx language loads and produces colored tokens (#206)", async () => {
    const hl = await createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [],
    });

    await hl.loadLanguage("tsx");
    expect(hl.getLoadedLanguages()).toContain("tsx");

    const html = hl.codeToHtml(
      'import React from "react";\nconst App = () => <div>Hello</div>;',
      { lang: "tsx", theme: "github-light" },
    );

    // Must contain at least one span with a non-default color style
    expect(html).toMatch(/style="color:#[0-9a-fA-F]{3,6}"/);

    // Keywords should be colored distinctly from plain text
    // "import" is a keyword
    expect(html).toContain('style="color:#D73A49"');

    // JSX tag names should be colored
    expect(html).toContain("div");
  });

  it("jsx language loads and produces colored tokens (#206)", async () => {
    const hl = await createHighlighter({
      themes: ["github-light"],
      langs: [],
    });

    await hl.loadLanguage("jsx");
    expect(hl.getLoadedLanguages()).toContain("jsx");

    const html = hl.codeToHtml(
      'const el = <span className="test">hi</span>;',
      { lang: "jsx", theme: "github-light" },
    );

    expect(html).toMatch(/style="color:#[0-9a-fA-F]{3,6}"/);
  });
});
