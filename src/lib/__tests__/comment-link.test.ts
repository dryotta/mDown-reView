import { describe, it, expect } from "vitest";
import { buildCommentLink } from "../comment-link";

describe("buildCommentLink", () => {
  it("strips workspace root and emits relative path with line", () => {
    expect(
      buildCommentLink({
        filePath: "/repo/src/foo.md",
        line: 42,
        workspaceRoot: "/repo",
      }),
    ).toBe("mdrv://src/foo.md?line=42");
  });

  it("emits absolute-ish path when workspaceRoot is null", () => {
    expect(
      buildCommentLink({ filePath: "/repo/src/foo.md", line: 7, workspaceRoot: null }),
    ).toBe("mdrv:///repo/src/foo.md?line=7");
  });

  it("omits ?line= when line is undefined", () => {
    expect(
      buildCommentLink({ filePath: "/repo/src/foo.md", workspaceRoot: "/repo" }),
    ).toBe("mdrv://src/foo.md");
  });

  it("omits ?line= when line is NaN", () => {
    expect(
      buildCommentLink({ filePath: "/repo/foo.md", line: NaN, workspaceRoot: "/repo" }),
    ).toBe("mdrv://foo.md");
  });

  it("includes ?line=0 (zero is a real line value)", () => {
    expect(
      buildCommentLink({ filePath: "/repo/foo.md", line: 0, workspaceRoot: "/repo" }),
    ).toBe("mdrv://foo.md?line=0");
  });

  it("normalizes Windows backslashes to forward slashes", () => {
    expect(
      buildCommentLink({
        filePath: "C:\\repo\\src\\foo.md",
        line: 3,
        workspaceRoot: "C:\\repo",
      }),
    ).toBe("mdrv://src/foo.md?line=3");
  });

  it("handles mixed slashes in path and root", () => {
    expect(
      buildCommentLink({
        filePath: "C:/repo\\src/foo.md",
        line: 1,
        workspaceRoot: "C:\\repo/",
      }),
    ).toBe("mdrv://src/foo.md?line=1");
  });

  it("leaves path untouched when root does not match prefix", () => {
    expect(
      buildCommentLink({
        filePath: "/other/foo.md",
        line: 9,
        workspaceRoot: "/repo",
      }),
    ).toBe("mdrv:///other/foo.md?line=9");
  });
});
