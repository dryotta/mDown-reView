import { describe, it, expect } from "vitest";
import { unified } from "unified";
import rehypeParse from "rehype-parse";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { sanitizeSchema } from "../sanitizeSchema";

function sanitize(html: string): string {
  return String(
    unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeSanitize, sanitizeSchema)
      .use(rehypeStringify)
      .processSync(html),
  );
}

describe("sanitizeSchema", () => {
  it("preserves <details>/<summary> with the open attribute", () => {
    const out = sanitize("<details open><summary>hi</summary>body</details>");
    expect(out).toContain("<details");
    expect(out).toContain("open");
    expect(out).toContain("<summary>hi</summary>");
    expect(out).toContain("body");
  });

  it("strips <script> tags entirely", () => {
    const out = sanitize("<p>safe</p><script>alert(1)</script>");
    expect(out).toContain("<p>safe</p>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("strips on* event handler attributes", () => {
    const out = sanitize('<a href="https://x" onclick="alert(1)">x</a>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain("href");
  });

  it("strips inline style attributes", () => {
    const out = sanitize('<p style="color:red">x</p>');
    expect(out).not.toMatch(/style=/i);
    expect(out).toContain("<p>");
  });

  it("blocks javascript: URLs in href", () => {
    const out = sanitize('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it("strips <iframe> entirely", () => {
    const out = sanitize('<iframe src="https://evil"></iframe>');
    expect(out).not.toContain("<iframe");
  });

  it("preserves <kbd>, <sub>, <sup>, <mark>", () => {
    const out = sanitize("<kbd>K</kbd><sub>s</sub><sup>p</sup><mark>m</mark>");
    expect(out).toContain("<kbd>K</kbd>");
    expect(out).toContain("<sub>s</sub>");
    expect(out).toContain("<sup>p</sup>");
    expect(out).toContain("<mark>m</mark>");
  });

  it("preserves img width/height attributes", () => {
    const out = sanitize('<img src="x.png" width="100" height="50" alt="a">');
    expect(out).toMatch(/width=("100"|100)/);
    expect(out).toMatch(/height=("50"|50)/);
  });
});
