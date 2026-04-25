import { describe, it, expect } from "vitest";
import { resolveWorkspacePath } from "../path-utils";

describe("resolveWorkspacePath", () => {
  const root = "/work/repo";
  const baseDir = "/work/repo/docs";

  it("resolves a relative href against baseDir", () => {
    expect(resolveWorkspacePath(root, baseDir, "./other.md")).toEqual({
      path: "/work/repo/docs/other.md",
      fragment: null,
    });
  });

  it("treats workspace-root-relative '/foo.md' as <root>/foo.md", () => {
    expect(resolveWorkspacePath(root, baseDir, "/foo.md")).toEqual({
      path: "/work/repo/foo.md",
      fragment: null,
    });
  });

  it("rejects parent-traversal escape outside workspace", () => {
    expect(resolveWorkspacePath(root, baseDir, "../../escape.md")).toBeNull();
    expect(
      resolveWorkspacePath(root, baseDir, "../../../../etc/passwd"),
    ).toBeNull();
  });

  it("rejects Windows-drive absolute paths", () => {
    expect(resolveWorkspacePath(root, baseDir, "C:/etc/x")).toBeNull();
    expect(resolveWorkspacePath(root, baseDir, "c:\\windows\\foo")).toBeNull();
  });

  it("URL-decodes the pathname", () => {
    expect(resolveWorkspacePath(root, baseDir, "./foo%20bar.md")).toEqual({
      path: "/work/repo/docs/foo bar.md",
      fragment: null,
    });
  });

  it("returns null on malformed percent-encoding", () => {
    expect(resolveWorkspacePath(root, baseDir, "./bad%2.md")).toBeNull();
  });

  it("strips and returns the URL fragment", () => {
    expect(resolveWorkspacePath(root, baseDir, "./other.md#section")).toEqual({
      path: "/work/repo/docs/other.md",
      fragment: "section",
    });
  });

  it("strips the query string before resolving", () => {
    expect(resolveWorkspacePath(root, baseDir, "./other.md?x=1")).toEqual({
      path: "/work/repo/docs/other.md",
      fragment: null,
    });
  });

  it("falls back to baseDir-as-root when workspaceRoot is empty", () => {
    // Single-file open: no workspace folder. Containment falls back to
    // baseDir so escapes are still blocked.
    expect(resolveWorkspacePath("", baseDir, "./a.md")).toEqual({
      path: "/work/repo/docs/a.md",
      fragment: null,
    });
    expect(resolveWorkspacePath("", baseDir, "../escape")).toBeNull();
  });

  it("normalises backslashes to forward slashes", () => {
    expect(resolveWorkspacePath(root, baseDir, ".\\sub\\f.md")).toEqual({
      path: "/work/repo/docs/sub/f.md",
      fragment: null,
    });
  });

  it("rejects href that resolves exactly to a sibling of root", () => {
    expect(resolveWorkspacePath(root, baseDir, "../../sibling.md")).toBeNull();
  });
});
