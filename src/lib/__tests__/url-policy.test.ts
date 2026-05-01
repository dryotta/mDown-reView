import { describe, it, expect } from "vitest";
import { routeLinkClick, assertNeverLinkRoute, type LinkRoute } from "../url-policy";

const ctx = { baseDir: "/wk/sub", workspaceRoot: "/wk" };

describe("routeLinkClick", () => {
  it("routes a fragment", () => {
    const r = routeLinkClick("#anchor", ctx);
    expect(r).toEqual({ kind: "fragment", fragment: "anchor" });
  });

  it("routes an external https URL", () => {
    expect(routeLinkClick("https://example.com/x", ctx)).toEqual({
      kind: "external",
      href: "https://example.com/x",
    });
    expect(routeLinkClick("HTTP://Example.com", ctx).kind).toBe("external");
    expect(routeLinkClick("mailto:a@b.com", ctx).kind).toBe("external");
    expect(routeLinkClick("tel:+15551234", ctx).kind).toBe("external");
  });

  it("routes a workspace-relative path", () => {
    const r = routeLinkClick("./sibling.md", ctx);
    expect(r.kind).toBe("workspace");
    if (r.kind === "workspace") {
      expect(r.path).toBe("/wk/sub/sibling.md");
    }
  });

  it("preserves fragment on workspace paths", () => {
    const r = routeLinkClick("./other.md#h1", ctx);
    expect(r.kind).toBe("workspace");
    if (r.kind === "workspace") {
      expect(r.path).toBe("/wk/sub/other.md");
      expect(r.fragment).toBe("h1");
    }
  });

  it("routes a POSIX-absolute path as absolute-blocked posix", () => {
    const r = routeLinkClick("/etc/passwd", ctx);
    expect(r).toEqual({ kind: "absolute-blocked", href: "/etc/passwd", flavor: "posix" });
  });

  it("routes a Windows drive-letter path as absolute-blocked windows", () => {
    const r = routeLinkClick("C:\\Users\\me\\file.md", ctx);
    expect(r.kind).toBe("absolute-blocked");
    if (r.kind === "absolute-blocked") expect(r.flavor).toBe("windows");
  });

  it("routes a UNC path as absolute-blocked unc", () => {
    const r = routeLinkClick("\\\\server\\share\\x.md", ctx);
    expect(r.kind).toBe("absolute-blocked");
    if (r.kind === "absolute-blocked") expect(r.flavor).toBe("unc");
  });

  it("routes URL-encoded UNC as absolute-blocked unc", () => {
    const r = routeLinkClick("%5C%5Cserver%5Cshare%5Cx.md", ctx);
    expect(r.kind).toBe("absolute-blocked");
    if (r.kind === "absolute-blocked") expect(r.flavor).toBe("unc");
  });

  it("routes a javascript scheme as scheme-blocked", () => {
    const r = routeLinkClick("javascript:alert(1)", ctx);
    expect(r).toEqual({
      kind: "scheme-blocked",
      href: "javascript:alert(1)",
      scheme: "javascript",
    });
  });

  it("routes a data scheme as scheme-blocked", () => {
    const r = routeLinkClick("data:text/html,<script>", ctx);
    expect(r.kind).toBe("scheme-blocked");
    if (r.kind === "scheme-blocked") expect(r.scheme).toBe("data");
  });

  it("routes a vbscript scheme as scheme-blocked", () => {
    const r = routeLinkClick("vbscript:msgbox(1)", ctx);
    expect(r.kind).toBe("scheme-blocked");
    if (r.kind === "scheme-blocked") expect(r.scheme).toBe("vbscript");
  });

  it("routes a file URL as scheme-blocked", () => {
    const r = routeLinkClick("file:///etc/passwd", ctx);
    expect(r.kind).toBe("scheme-blocked");
    if (r.kind === "scheme-blocked") expect(r.scheme).toBe("file");
  });

  it("routes outside-workspace as other-blocked outside-workspace", () => {
    const r = routeLinkClick("../../../../etc/passwd", ctx);
    expect(r.kind).toBe("other-blocked");
    if (r.kind === "other-blocked") expect(r.reason).toBe("outside-workspace");
  });

  it("routes a too-long href as other-blocked type/length", () => {
    const big = "https://example.com/" + "a".repeat(5000);
    const r = routeLinkClick(big, ctx);
    expect(r.kind).toBe("other-blocked");
    if (r.kind === "other-blocked") expect(r.reason).toBe("type/length");
  });

  it("routes non-string input as other-blocked type/length", () => {
    expect(routeLinkClick(undefined, ctx).kind).toBe("other-blocked");
    expect(routeLinkClick(null, ctx).kind).toBe("other-blocked");
    expect(routeLinkClick(42, ctx).kind).toBe("other-blocked");
    expect(routeLinkClick({ href: "x" }, ctx).kind).toBe("other-blocked");
  });

  it("strips leading whitespace before scheme classification", () => {
    // A naive `startsWith("javascript:")` would miss this; we strip first.
    const r = routeLinkClick("\n\t javascript:alert(1)", ctx);
    expect(r.kind).toBe("scheme-blocked");
    if (r.kind === "scheme-blocked") expect(r.scheme).toBe("javascript");
  });

  it("routes workspace-relative as other-blocked no-basedir when baseDir is missing", () => {
    const r = routeLinkClick("./x.md", { baseDir: undefined, workspaceRoot: "/wk" });
    expect(r.kind).toBe("other-blocked");
    if (r.kind === "other-blocked") expect(r.reason).toBe("no-basedir");
  });

  it("compile-time exhaustiveness with assertNeverLinkRoute", () => {
    // Compiler oracle: passing a real `LinkRoute` to the `never` slot must
    // fail to typecheck. The `@ts-expect-error` directive itself fails the
    // build if the call would actually compile, so this test asserts the
    // type-level invariant. Runtime side: the helper throws with a
    // descriptive message — we capture both signals here.
    const route: LinkRoute = { kind: "fragment", fragment: "x" };
    expect(() => {
      // @ts-expect-error -- LinkRoute is not assignable to `never` by design
      assertNeverLinkRoute(route);
    }).toThrow(/unhandled LinkRoute kind/);
  });
});
