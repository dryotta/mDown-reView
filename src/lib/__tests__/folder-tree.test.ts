import { describe, it, expect } from "vitest";
import {
  pathStartsWithRootCrossPlatform,
  getAncestors,
  buildGroupedFilterResult,
  computeWatchedDirs,
} from "../folder-tree";
import type { DirEntry } from "@/lib/tauri-commands";

describe("pathStartsWithRootCrossPlatform", () => {
  it("matches identical paths", () => {
    expect(pathStartsWithRootCrossPlatform("/r", "/r")).toBe(true);
  });
  it("matches a child path", () => {
    expect(pathStartsWithRootCrossPlatform("/r/a/b.md", "/r")).toBe(true);
  });
  it("rejects a sibling that shares a prefix", () => {
    expect(pathStartsWithRootCrossPlatform("/root2/a", "/root")).toBe(false);
  });
  it("treats / and \\ as equivalent", () => {
    expect(pathStartsWithRootCrossPlatform("C:\\r\\a", "C:/r")).toBe(true);
    expect(pathStartsWithRootCrossPlatform("C:/r/a", "C:\\r")).toBe(true);
  });
  it("returns false for empty inputs", () => {
    expect(pathStartsWithRootCrossPlatform("", "/r")).toBe(false);
    expect(pathStartsWithRootCrossPlatform("/r", "")).toBe(false);
  });
});

describe("getAncestors", () => {
  it("returns chain from root (exclusive) to immediate parent (inclusive)", () => {
    expect(getAncestors("/r", "/r/a/b/c.md")).toEqual(["/r/a", "/r/a/b"]);
  });
  it("returns [] for files directly in root", () => {
    expect(getAncestors("/r", "/r/file.md")).toEqual([]);
  });
  it("returns [] when path is outside root", () => {
    expect(getAncestors("/r", "/other/x.md")).toEqual([]);
  });
  it("preserves backslash separators on windows-style paths", () => {
    expect(getAncestors("C:\\r", "C:\\r\\a\\b.md")).toEqual(["C:\\r\\a"]);
  });
});

describe("buildGroupedFilterResult", () => {
  const ROOT = "/r";
  const cache: Record<string, DirEntry[]> = {
    "/r": [
      { name: "alpha.md", path: "/r/alpha.md", is_dir: false },
      { name: "sub", path: "/r/sub", is_dir: true },
      { name: "skip.txt", path: "/r/skip.txt", is_dir: false },
    ],
    "/r/sub": [
      { name: "beta.md", path: "/r/sub/beta.md", is_dir: false },
      { name: "gamma.md", path: "/r/sub/gamma.md", is_dir: false },
    ],
  };

  it("groups by immediate parent and sorts by relative path", () => {
    const groups = buildGroupedFilterResult(ROOT, cache, ".md");
    expect(groups).toHaveLength(2);
    expect(groups[0].relativePath).toBe("");
    expect(groups[0].files.map((f) => f.name)).toEqual(["alpha.md"]);
    expect(groups[1].relativePath).toBe("sub");
    expect(groups[1].files.map((f) => f.name)).toEqual(["beta.md", "gamma.md"]);
  });

  it("is case-insensitive on file name", () => {
    const g = buildGroupedFilterResult(ROOT, cache, "ALPHA");
    expect(g).toHaveLength(1);
    expect(g[0].files[0].name).toBe("alpha.md");
  });

  it("returns [] when filter is empty", () => {
    expect(buildGroupedFilterResult(ROOT, cache, "")).toEqual([]);
  });

  it("returns [] when root is null", () => {
    expect(buildGroupedFilterResult(null, cache, "x")).toEqual([]);
  });

  it("respects the entryCap budget", () => {
    const big: Record<string, DirEntry[]> = {
      "/r": Array.from({ length: 50 }, (_, i) => ({
        name: `f${i}.md`,
        path: `/r/f${i}.md`,
        is_dir: false,
      })),
    };
    const groups = buildGroupedFilterResult("/r", big, ".md", { entryCap: 5 });
    expect(groups[0].files.length).toBeLessThanOrEqual(5);
  });
});

describe("computeWatchedDirs", () => {
  it("returns just [root] when nothing is expanded", () => {
    expect(computeWatchedDirs("/r", [])).toEqual(["/r"]);
  });

  it("prepends root and preserves order of expanded dirs", () => {
    expect(computeWatchedDirs("/r", ["/r/a", "/r/b"])).toEqual([
      "/r",
      "/r/a",
      "/r/b",
    ]);
  });

  it("dedupes when an expanded dir matches root", () => {
    expect(computeWatchedDirs("/r", ["/r", "/r/a"])).toEqual(["/r", "/r/a"]);
  });

  it("dedupes repeated expanded entries", () => {
    expect(computeWatchedDirs("/r", ["/r/a", "/r/a", "/r/b"])).toEqual([
      "/r",
      "/r/a",
      "/r/b",
    ]);
  });
});
