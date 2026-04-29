import { describe, it, expect } from "vitest";
import { tooltipForRoute, injectAnchorTitles } from "../html-anchor-titles";
import type { LinkRoute } from "../url-policy";

describe("tooltipForRoute", () => {
  it("returns the URL for external routes", () => {
    const route: LinkRoute = { kind: "external", href: "https://tauri.app" };
    expect(tooltipForRoute(route, "/wk")).toBe("https://tauri.app");
  });

  it("returns workspace-relative path for workspace routes", () => {
    const route: LinkRoute = { kind: "workspace", path: "/wk/docs/intro.md" };
    expect(tooltipForRoute(route, "/wk")).toBe("docs/intro.md");
  });

  it("appends decoded fragment for workspace routes", () => {
    const route: LinkRoute = {
      kind: "workspace",
      path: "/wk/docs/intro.md",
      fragment: "getting-started",
    };
    expect(tooltipForRoute(route, "/wk")).toBe("docs/intro.md#getting-started");
  });

  it("URL-decodes fragments (%C3%A9 → é)", () => {
    const route: LinkRoute = { kind: "fragment", fragment: "caf%C3%A9" };
    expect(tooltipForRoute(route, "/wk")).toBe("#café");
  });

  it("falls back to absolute path when not under workspace root", () => {
    const route: LinkRoute = { kind: "workspace", path: "/other/file.md" };
    expect(tooltipForRoute(route, "/wk")).toBe("/other/file.md");
  });

  it("returns the workspace root itself when path equals root", () => {
    const route: LinkRoute = { kind: "workspace", path: "/wk" };
    expect(tooltipForRoute(route, "/wk")).toBe("/wk");
  });

  it("returns null for blocked routes (caller should omit title)", () => {
    const route: LinkRoute = { kind: "blocked", href: "javascript:x", reason: "blocked-scheme" };
    expect(tooltipForRoute(route, "/wk")).toBeNull();
  });

  it("normalises Windows-style separators in workspace path", () => {
    const route: LinkRoute = { kind: "workspace", path: "C:\\wk\\sub\\page.md" };
    expect(tooltipForRoute(route, "C:\\wk")).toBe("sub/page.md");
  });
});

describe("injectAnchorTitles", () => {
  const ctx = { baseDir: "/wk/sub", workspaceRoot: "/wk" };

  it("stamps a title onto an external anchor", () => {
    const html = '<a href="https://example.com">x</a>';
    expect(injectAnchorTitles(html, ctx)).toBe(
      '<a href="https://example.com" title="https://example.com">x</a>',
    );
  });

  it("stamps workspace-relative title with fragment", () => {
    const html = '<a href="./other.html#part-1">x</a>';
    expect(injectAnchorTitles(html, ctx)).toBe(
      '<a href="./other.html#part-1" title="sub/other.html#part-1">x</a>',
    );
  });

  it("preserves an author-supplied title attribute", () => {
    const html = '<a href="https://example.com" title="Existing">x</a>';
    expect(injectAnchorTitles(html, ctx)).toBe(html);
  });

  it("skips anchors with no href", () => {
    const html = '<a name="x">y</a>';
    expect(injectAnchorTitles(html, ctx)).toBe(html);
  });

  it("skips empty href", () => {
    const html = '<a href="">y</a>';
    expect(injectAnchorTitles(html, ctx)).toBe(html);
  });

  it("skips blocked URL schemes (no title attribute added)", () => {
    const html = '<a href="javascript:alert(1)">x</a>';
    expect(injectAnchorTitles(html, ctx)).toBe(html);
  });

  it("supports single-quoted href attribute", () => {
    const html = "<a href='https://example.com'>x</a>";
    const out = injectAnchorTitles(html, ctx);
    expect(out).toContain('title="https://example.com"');
  });

  it("HTML-escapes characters inside the title value", () => {
    const html = '<a href="https://x.com/?q=&lt;hi&gt;">x</a>';
    const out = injectAnchorTitles(html, ctx);
    // The href value already contains literal `&lt;`/`&gt;`; in the title
    // attribute the `&` gets re-escaped to `&amp;` so the browser preserves
    // the original character sequence on display.
    expect(out).toContain('title="https://x.com/?q=&amp;lt;hi&amp;gt;"');
  });

  it("emits a #fragment title for fragment-only anchors", () => {
    const html = '<a href="#sec">x</a>';
    expect(injectAnchorTitles(html, ctx)).toBe(
      '<a href="#sec" title="#sec">x</a>',
    );
  });

  it("processes multiple anchors independently", () => {
    const html = '<a href="https://a.com">a</a> and <a href="./b.md">b</a>';
    const out = injectAnchorTitles(html, ctx);
    expect(out).toContain('title="https://a.com"');
    expect(out).toContain('title="sub/b.md"');
  });
});
